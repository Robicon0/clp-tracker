"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getClaims,
  getOutlierDismissals,
  getPositions,
  getSettings,
  getTransfers,
  getWithdrawals,
  migrateTransferMoneyStatus,
  saveOutlierDismissals,
  saveTransfers,
  saveWithdrawals,
} from "../../lib/storage";
import {
  correctTransferSymbol,
  dismissalFor,
  findTransferAmountOutliers,
  findTransferSymbolMismatches,
  type OutlierRow,
  type TransferSymbolMismatchRow,
} from "../../lib/dataHealth";
import { OutlierBanner } from "../../components/OutlierBanner";
import { PositionCombobox } from "../../components/PositionCombobox";
import { normalizeChain, normalizeToken } from "../../lib/nameNormalization";
import {
  buildClaimTransfers,
  createUpsideTransfer,
  eligibleClaimsForBackfill,
  eligibleClosesForBackfill,
  reconcileClaimTransfers,
} from "../../lib/transferAutomation";
import { useHydrated } from "../../lib/useHydrated";
import type {
  AppSettings,
  FeeClaim,
  OutlierDismissal,
  Position,
  Transfer,
  Withdrawal,
} from "../../lib/types";

type TransferType = Transfer["transferType"];
type MoneyStatus = NonNullable<Transfer["moneyStatus"]>;

const TYPE_LABELS: Record<TransferType, string> = {
  fees: "Fees",
  undeployed: "Undeployed Tokens",
  outOfRangeUpside: "Out of Range Upside",
  expense: "Expense",
};

const SHORT_TYPE_LABELS: Record<TransferType, string> = {
  fees: "Fees",
  undeployed: "Undeployed",
  outOfRangeUpside: "OOR Upside",
  expense: "Expense",
};

const TYPE_PILL: Record<TransferType, string> = {
  fees: "bg-blue-500/10 text-blue-300 ring-blue-500/30",
  undeployed: "bg-purple-500/10 text-purple-300 ring-purple-500/30",
  outOfRangeUpside: "bg-orange-500/10 text-orange-300 ring-orange-500/30",
  expense: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(value: number): string {
  return usdFormatter.format(Number.isFinite(value) ? value : 0);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateDDMMYYYY(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function todayDateInput(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

interface TransferFormState {
  positionId: string;
  date: string;
  token: string;
  amount: string;
  platform: string;
  destination: string;
  transferType: TransferType;
  moneyStatus: MoneyStatus;
  notes: string;
}

const EMPTY_FORM: TransferFormState = {
  positionId: "",
  date: "",
  token: "",
  amount: "",
  platform: "",
  destination: "",
  transferType: "fees",
  // Redeployed is the safe default: it has no P&L impact, so a transfer
  // saved without thinking about it cannot invent an expense.
  moneyStatus: "redeployed",
  notes: "",
};

function transferToForm(t: Transfer): TransferFormState {
  return {
    positionId: t.positionId,
    date: t.date.slice(0, 10),
    token: t.token,
    amount: String(t.amount),
    platform: t.platform,
    destination: t.destination,
    transferType: t.transferType,
    moneyStatus: t.moneyStatus ?? "redeployed",
    notes: t.notes,
  };
}

function buildTransfer(id: string, form: TransferFormState): Transfer {
  return {
    id,
    positionId: form.positionId,
    date: form.date,
    token: form.token.trim().toUpperCase(),
    amount: num(form.amount),
    platform: form.platform.trim().toUpperCase(),
    destination: form.destination.trim().toUpperCase(),
    transferType: form.transferType,
    // Undeployed Tokens are idle — moneyStatus stays unset ("idle, not yet
    // decided") until the user marks them deployed or edits to an expense.
    moneyStatus:
      form.transferType === "undeployed" ? undefined : form.moneyStatus,
    notes: form.notes.trim().toUpperCase(),
  };
}

// Expenses are position-less: money that has left the business. They reuse the
// Transfer record (positionId "", token "", transferType/moneyStatus "expense")
// but have their own minimal form — Date, Amount, Notes — since picking a
// position/token/platform makes no sense for them.
interface ExpenseFormState {
  date: string;
  amount: string;
  notes: string;
}


function expenseToForm(t: Transfer): ExpenseFormState {
  return {
    date: t.date.slice(0, 10),
    amount: String(t.amount),
    notes: t.notes,
  };
}

function buildExpense(id: string, form: ExpenseFormState): Transfer {
  return {
    id,
    positionId: "",
    date: form.date,
    token: "",
    amount: num(form.amount),
    platform: "",
    destination: "",
    transferType: "expense",
    moneyStatus: "expense",
    notes: form.notes.trim().toUpperCase(),
  };
}

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; transfer: Transfer }
  | { kind: "editExpense"; transfer: Transfer }
  | { kind: "deploy"; transfer: Transfer }
  | { kind: "addWithdrawal" }
  | { kind: "editWithdrawal"; withdrawal: Withdrawal };

type TypeFilter = "all" | TransferType;

interface WithdrawalFormState {
  date: string;
  amount: string;
  method: string;
  notes: string;
}

const EMPTY_WITHDRAWAL_FORM: WithdrawalFormState = {
  date: "",
  amount: "",
  method: "",
  notes: "",
};

function withdrawalToForm(w: Withdrawal): WithdrawalFormState {
  return {
    date: w.date.slice(0, 10),
    amount: String(w.amount),
    method: w.method,
    notes: w.notes,
  };
}

function buildWithdrawal(id: string, form: WithdrawalFormState): Withdrawal {
  return {
    id,
    date: form.date,
    amount: num(form.amount),
    method: form.method.trim().toUpperCase(),
    notes: form.notes.trim().toUpperCase(),
  };
}

// Compact, tap-to-expand transfer row (Part 5) with a bulk-select checkbox
// (Part 4). No table, so it reflows to any width without horizontal scroll.
// Collapsed: select box, Date, Pair, Amount, Type, Money Status. Expanded adds
// Platform, Destination, Notes and the Edit/Delete actions.
function TransferListRow({
  transfer: t,
  pairLabel,
  deployedLabel,
  selected,
  onToggleSelect,
  pendingDelete,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onEdit,
  onMarkDeployed,
  onUnlinkDeployed,
}: {
  transfer: Transfer;
  pairLabel: string;
  deployedLabel: string | null;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  pendingDelete: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  onEdit: (t: Transfer) => void;
  onMarkDeployed: (t: Transfer) => void;
  onUnlinkDeployed: (t: Transfer) => void;
}) {
  const [open, setOpen] = useState(false);
  // A deployed transfer is settled — visually locked (dimmed). Editing still
  // requires an explicit Edit click inside the expanded row (Part 4).
  const isDeployed = t.deployedToPositionId !== undefined;
  return (
    <div
      className={`${selected ? "bg-[var(--accent)]/[0.06]" : ""} ${
        isDeployed ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(t.id)}
          aria-label="Select transfer"
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span className="mt-0.5 text-[10px] text-[var(--muted)]">
            {open ? "▴" : "▾"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-[var(--foreground)]">
                {pairLabel}
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--foreground)]">
                {formatUsd(t.amount)}
              </span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <span className="tabular-nums">{formatDateDDMMYYYY(t.date)}</span>
              <TypePill type={t.transferType} />
              <MoneyStatusPill status={t.moneyStatus} />
              {deployedLabel && (
                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                  Used → {deployedLabel}
                </span>
              )}
            </span>
          </span>
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--surface-2)]/20 px-3 py-3 pl-9">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Platform
              </dt>
              <dd className="text-[13px] text-[var(--foreground)]">
                {t.platform || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Destination
              </dt>
              <dd className="text-[13px] text-[var(--foreground)]">
                {t.destination || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Token
              </dt>
              <dd className="text-[13px] text-[var(--foreground)]">
                {t.token || "—"}
              </dd>
            </div>
          </dl>
          {t.notes && (
            <p className="mt-2 text-[12px] text-[var(--muted)]">{t.notes}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pendingDelete === t.id ? (
              <>
                <span className="text-xs text-[var(--muted)]">
                  Delete this transfer?
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteConfirm(t.id)}
                  className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={onDeleteCancel}
                  className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(t)}
                  className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                >
                  Edit
                </button>
                {/* Deploy-linking applies to Redeployed money AND idle
                    Undeployed Tokens (Part 4) — never to Expenses. */}
                {t.transferType !== "expense" &&
                  (t.moneyStatus === "redeployed" ||
                    t.moneyStatus === undefined) &&
                  (t.deployedToPositionId ? (
                    <button
                      type="button"
                      onClick={() => onUnlinkDeployed(t)}
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Remove deploy link
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMarkDeployed(t)}
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Mark as deployed
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => onDeleteRequest(t.id)}
                  className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// A transfer's token must belong to its linked position's pair (same substring
// test as the Position/Claim detectors). Offers a confirmed one-click fix that
// rewrites to the pair-derived symbol, plus per-row Edit. Detection-only until
// the user confirms.
function TransferSymbolBanner({
  rows,
  onEdit,
  onFixAll,
}: {
  rows: TransferSymbolMismatchRow[];
  onEdit: (t: Transfer) => void;
  onFixAll: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const fixable = rows.filter((r) => r.suggestedSymbol !== "").length;
  return (
    <div
      id="transfer-symbol-issues"
      className="rounded-lg border border-red-500/50 bg-red-500/[0.07] px-5 py-4"
    >
      <h2 className="text-sm font-semibold text-red-300">
        {rows.length} {rows.length === 1 ? "transfer has" : "transfers have"} a
        token that doesn&apos;t match its position&apos;s pair
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        A transfer&apos;s token should belong to the pair of the position it is
        linked to (e.g. SOL on a SUI/USDC position is wrong). Fixing rewrites it
        to the pair token. Nothing changes until you confirm.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.transfer.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-[12px]"
          >
            <span className="font-medium text-[var(--foreground)]">
              {formatDateDDMMYYYY(r.transfer.date)} · {r.position.pair}
            </span>
            <span className="tabular-nums text-[var(--muted)]">
              <span className="font-medium text-red-300">{r.token}</span>
              {r.suggestedSymbol && <> → {r.suggestedSymbol}</>}
            </span>
            <button
              type="button"
              onClick={() => onEdit(r.transfer)}
              className="rounded-md border border-red-500/50 px-2.5 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/10"
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      {fixable > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[12px] text-red-300">
                Rewrite the token on {fixable}{" "}
                {fixable === 1 ? "transfer" : "transfers"}?
              </span>
              <button
                type="button"
                onClick={() => {
                  onFixAll();
                  setConfirming(false);
                }}
                className="rounded-md bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-500"
              >
                Yes, fix {fixable}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border border-red-500/50 px-3 py-1.5 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-500/10"
            >
              Fix all {fixable} {fixable === 1 ? "transfer" : "transfers"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TransfersPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<MoneyStatus | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingWithdrawalDelete, setPendingWithdrawalDelete] = useState<
    string | null
  >(null);

  const [dismissals, setDismissals] = useState<OutlierDismissal[]>([]);

  const refresh = () => {
    setSettings(getSettings());
    setTransfers(getTransfers());
    setWithdrawals(getWithdrawals());
    setPositions(getPositions());
    setClaims(getClaims());
    setDismissals(getOutlierDismissals());
  };

  const hydrated = useHydrated(() => {
    // Retire "Needs Review": persist an explicit moneyStatus on any legacy
    // transfer that never had one (no-op for totals — unset already behaved as
    // redeployed). Runs once; idempotent thereafter.
    migrateTransferMoneyStatus();
    refresh();
  });

  const positionPairById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of positions) map.set(p.id, p.pair);
    return map;
  }, [positions]);

  // Data Health: a transfer's token must belong to its linked position's pair,
  // and its amount should sit within that position's usual range.
  const transferMismatches = useMemo(
    () => (hydrated ? findTransferSymbolMismatches(transfers, positions) : []),
    [hydrated, transfers, positions],
  );
  const transferOutliers = useMemo(
    () =>
      hydrated
        ? findTransferAmountOutliers(transfers, positions, dismissals)
        : [],
    [hydrated, transfers, positions, dismissals],
  );

  const sortedFiltered = useMemo(() => {
    if (!hydrated) return [];
    const filtered = transfers.filter((t) =>
      typeFilter === "all" ? true : t.transferType === typeFilter,
    );
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [hydrated, transfers, typeFilter]);

  // Free-text search over pair, notes, transfer type, token, destination,
  // platform — layered on top of the type/review filters (Part 5).
  const searchedFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return sortedFiltered;
    return sortedFiltered.filter((t) => {
      const pair = positionPairById.get(t.positionId) ?? "";
      const haystack = [
        pair,
        t.notes,
        TYPE_LABELS[t.transferType],
        t.token,
        t.destination,
        t.platform,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sortedFiltered, search, positionPairById]);

  const totals = useMemo(() => {
    let amount = 0;
    const breakdown: Record<TransferType, number> = {
      fees: 0,
      undeployed: 0,
      outOfRangeUpside: 0,
      expense: 0,
    };
    for (const t of transfers) {
      amount += t.amount;
      breakdown[t.transferType] += 1;
    }
    return { count: transfers.length, amount, breakdown };
  }, [transfers]);

  // Per-token NET TOTAL (Σ amount moved out of that token), mirroring the
  // sheet's per-token blocks. Sorted by amount so the biggest movers lead.
  const byToken = useMemo(() => {
    const map = new Map<string, { token: string; count: number; amount: number }>();
    for (const t of transfers) {
      const token = t.token ? normalizeToken(t.token) : "—";
      const row = map.get(token) ?? { token, count: 0, amount: 0 };
      row.count += 1;
      row.amount += t.amount;
      map.set(token, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [transfers]);

  // Per-destination breakdown (where the money went — RAKA, AAVE, …).
  // Transfers with no destination yet are grouped under "Unspecified".
  const byDestination = useMemo(() => {
    const map = new Map<
      string,
      { destination: string; count: number; amount: number }
    >();
    for (const t of transfers) {
      const destination = t.destination || "Unspecified";
      const row = map.get(destination) ?? { destination, count: 0, amount: 0 };
      row.count += 1;
      row.amount += t.amount;
      map.set(destination, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [transfers]);

  // Chain of a transfer = its linked position's chain (transfers store no chain
  // of their own). Expenses and any unlinked rows fall under "Unlinked". Sorted
  // by total moved so the busiest chains lead — mirrors Business P&L's blocks.
  const positionChainById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of positions) map.set(p.id, normalizeChain(p.chain) || "OTHER");
    return map;
  }, [positions]);

  const byChain = useMemo(() => {
    const map = new Map<string, Transfer[]>();
    for (const t of searchedFiltered) {
      const chain = positionChainById.get(t.positionId) ?? "UNLINKED";
      const list = map.get(chain);
      if (list) list.push(t);
      else map.set(chain, [t]);
    }
    const amountOf = (list: Transfer[]) =>
      list.reduce((sum, t) => sum + t.amount, 0);
    return [...map.entries()]
      .map(([chain, list]) => ({ chain, list, amount: amountOf(list) }))
      .sort((a, b) => b.amount - a.amount);
  }, [searchedFiltered, positionChainById]);

  // Bulk-select over the currently-visible (searched + filtered) rows. Selecting
  // ids that scroll out of view is avoided by intersecting with visibleIds on
  // every action, so a bulk mark only ever touches rows the user can see.
  const visibleIds = useMemo(
    () => searchedFiltered.map((t) => t.id),
    [searchedFiltered],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (visibleIds.every((id) => prev.has(id))) return new Set();
      return new Set(visibleIds);
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setPendingBulk(null);
  };

  // The only new way data changes here (Part 4): set moneyStatus on every
  // selected+visible transfer at once, behind an explicit confirm. transferType
  // is untouched — Overall P&L counts expenses by moneyStatus alone.
  const applyBulkMark = (status: MoneyStatus) => {
    const targetIds = new Set(visibleIds.filter((id) => selectedIds.has(id)));
    if (targetIds.size === 0) return;
    saveTransfers(
      getTransfers().map((t) =>
        targetIds.has(t.id) ? { ...t, moneyStatus: status } : t,
      ),
    );
    clearSelection();
    refresh();
  };

  const handleConfirmOutlier = (row: OutlierRow) => {
    saveOutlierDismissals([...getOutlierDismissals(), dismissalFor(row)]);
    setDismissals(getOutlierDismissals());
  };

  const handleEditExpense = (target: Transfer, form: ExpenseFormState) => {
    const updated = buildExpense(target.id, form);
    saveTransfers(
      getTransfers().map((t) => (t.id === target.id ? updated : t)),
    );
    refresh();
    setModal({ kind: "none" });
  };

  const handleAdd = (form: TransferFormState) => {
    saveTransfers([...getTransfers(), buildTransfer(newId(), form)]);
    refresh();
    setModal({ kind: "none" });
  };

  const handleEdit = (target: Transfer, form: TransferFormState) => {
    const updated = buildTransfer(target.id, form);
    saveTransfers(
      getTransfers().map((t) => (t.id === target.id ? updated : t)),
    );
    refresh();
    setModal({ kind: "none" });
  };

  const handleDelete = (id: string) => {
    saveTransfers(getTransfers().filter((t) => t.id !== id));
    refresh();
    setPendingDelete(null);
  };

  // Link a Redeployed transfer to the position its money went into. The row
  // stays in the list but drops out of Available Balance. Records the date so
  // the link is auditable. Never touches the position itself.
  const handleMarkDeployed = (target: Transfer, positionId: string) => {
    saveTransfers(
      getTransfers().map((t) =>
        t.id === target.id
          ? {
              ...t,
              deployedToPositionId: positionId,
              deployedAt: todayDateInput(),
            }
          : t,
      ),
    );
    refresh();
    setModal({ kind: "none" });
  };

  // Undo the link — clears both fields, returning the amount to Available.
  const handleUnlinkDeployed = (target: Transfer) => {
    saveTransfers(
      getTransfers().map((t) => {
        if (t.id !== target.id) return t;
        const { deployedToPositionId: _p, deployedAt: _a, ...rest } = t;
        void _p;
        void _a;
        return rest;
      }),
    );
    refresh();
  };

  // Explicit, user-confirmed bulk correction of mismatched transfer tokens.
  // Only rewrites rows with a determinable suggestion; others stay for manual
  // Edit. Detection-only elsewhere — this runs solely on the confirm click.
  const handleFixAllTransferSymbols = (rows: TransferSymbolMismatchRow[]) => {
    const fixes = new Map(
      rows
        .filter((r) => r.suggestedSymbol !== "")
        .map((r) => [r.transfer.id, correctTransferSymbol(r)]),
    );
    if (fixes.size === 0) return;
    saveTransfers(getTransfers().map((t) => fixes.get(t.id) ?? t));
    refresh();
  };

  // Balance ledger (Money Flow invariant): Lifetime Earned = Σ transfers
  // (every fee moved to a destination), Withdrawn = Σ withdrawals taken out
  // for personal use, Available Balance = the difference. Withdrawals never
  // reduce Lifetime Earned — only what's still available.
  const balance = useMemo(() => {
    const lifetimeEarned = transfers.reduce((sum, t) => sum + t.amount, 0);
    const withdrawn = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    // Money linked to a position ("Mark as deployed") is no longer idle — it
    // now lives inside that position's Deposited (entered separately), so it is
    // excluded from Available. Undoing the link adds it straight back.
    const deployed = transfers.reduce(
      (sum, t) => (t.deployedToPositionId ? sum + t.amount : sum),
      0,
    );
    return {
      lifetimeEarned,
      withdrawn,
      deployed,
      available: lifetimeEarned - withdrawn - deployed,
    };
  }, [transfers, withdrawals]);

  const sortedWithdrawals = useMemo(
    () =>
      [...withdrawals].sort((a, b) => {
        const ta = new Date(a.date).getTime();
        const tb = new Date(b.date).getTime();
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      }),
    [withdrawals],
  );

  const handleAddWithdrawal = (form: WithdrawalFormState) => {
    saveWithdrawals([...getWithdrawals(), buildWithdrawal(newId(), form)]);
    refresh();
    setModal({ kind: "none" });
  };

  const handleEditWithdrawal = (
    target: Withdrawal,
    form: WithdrawalFormState,
  ) => {
    const updated = buildWithdrawal(target.id, form);
    saveWithdrawals(
      getWithdrawals().map((w) => (w.id === target.id ? updated : w)),
    );
    refresh();
    setModal({ kind: "none" });
  };

  const handleDeleteWithdrawal = (id: string) => {
    saveWithdrawals(getWithdrawals().filter((w) => w.id !== id));
    refresh();
    setPendingWithdrawalDelete(null);
  };

  const transfersEnabled = !hydrated ? true : settings?.transfersEnabled !== false;

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Track where you send your claimed fees.
        </p>
      </header>

      {hydrated && !transfersEnabled ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            Transfers are disabled. Enable them in Settings to start tracking
            where you send your fees.
          </p>
          <Link
            href="/settings"
            className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
          >
            Go to Settings
          </Link>
        </div>
      ) : (
        <>
          {transferMismatches.length > 0 && (
            <TransferSymbolBanner
              rows={transferMismatches}
              onEdit={(transfer) => setModal({ kind: "edit", transfer })}
              onFixAll={() => handleFixAllTransferSymbols(transferMismatches)}
            />
          )}
          <OutlierBanner
            id="transfer-outliers"
            rows={transferOutliers}
            noun="transfer"
            onEdit={(row) =>
              row.transfer &&
              setModal(
                row.transfer.transferType === "expense"
                  ? { kind: "editExpense", transfer: row.transfer }
                  : { kind: "edit", transfer: row.transfer },
              )
            }
            onConfirm={handleConfirmOutlier}
          />

          <div className="flex justify-end gap-2">
            {/* Expense and Withdrawal were the same concept to the user, so
                they are one action now. It records a Withdrawal (reduces
                Available Balance) — the formula is unchanged. */}
            <button
              type="button"
              onClick={() => setModal({ kind: "addWithdrawal" })}
              className="inline-flex h-9 items-center justify-center rounded-md border border-rose-500/40 bg-rose-500/10 px-4 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
            >
              Log an Expense
            </button>
            <button
              type="button"
              onClick={() => setModal({ kind: "add" })}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
            >
              Add Transfer
            </button>
          </div>

          <BackfillReview
            claims={claims}
            positions={positions}
            transfers={transfers}
            onDone={refresh}
          />

          {/* Money Flow ledger: earned − withdrawn − deployed = available now. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryStat
              label="Lifetime Earned (USD)"
              value={formatUsd(balance.lifetimeEarned)}
              hint="Everything ever moved to a destination — never decreases."
            />
            <SummaryStat
              label="Expenses / Withdrawn (USD)"
              value={formatUsd(balance.withdrawn)}
              hint="Money logged out of the business (expenses / withdrawals). Reduces Available Balance."
            />
            <SummaryStat
              label="Deployed into Positions (USD)"
              value={formatUsd(balance.deployed)}
              hint="Redeployed money you've linked to a position — now inside its Deposited, no longer idle."
            />
            <SummaryStat
              label="Available Balance (USD)"
              value={formatUsd(balance.available)}
              hint="Lifetime Earned − Withdrawn − Deployed = what's still idle."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryStat label="Total Transfers" value={String(totals.count)} />
            <SummaryStat
              label="Transfers Net Total (USD)"
              value={formatUsd(totals.amount)}
            />
            <BreakdownStat breakdown={totals.breakdown} />
          </div>

          {byToken.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <GroupTable
                title="By Token"
                subtitle="Net total moved out per token."
                columnLabel="Token"
                rows={byToken.map((r) => ({
                  key: r.token,
                  label: r.token,
                  count: r.count,
                  amount: r.amount,
                }))}
                total={totals.amount}
              />
              <GroupTable
                title="By Destination"
                subtitle="Where the money went."
                columnLabel="Destination"
                rows={byDestination.map((r) => ({
                  key: r.destination,
                  label: r.destination,
                  count: r.count,
                  amount: r.amount,
                }))}
                total={totals.amount}
              />
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                Transfers by Chain
              </h2>
              <TypeFilterToggle value={typeFilter} onChange={setTypeFilter} />
            </div>

            <div className="border-b border-[var(--border)] px-5 py-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by pair, notes, type, destination…"
                className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            {searchedFiltered.length === 0 ? (
              transfers.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <EmptyIcon />
                  <h3 className="mt-3 text-base font-semibold tracking-tight text-[var(--foreground)]">
                    No transfers recorded
                  </h3>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
                    After claiming fees, record where you sent them.
                  </p>
                  <button
                    type="button"
                    onClick={() => setModal({ kind: "add" })}
                    className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
                  >
                    Add Transfer
                  </button>
                </div>
              ) : (
                <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                  No transfers match the current filter.
                </div>
              )
            ) : (
              <>
                {/* Bulk-select toolbar (Part 4). */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--surface-2)]/30 px-5 py-2.5">
                  <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Select all visible ({visibleIds.length})
                  </label>
                  {selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--foreground)]">
                        {selectedIds.size} selected
                      </span>
                      {pendingBulk ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-[var(--foreground)]">
                            Mark{" "}
                            {
                              visibleIds.filter((id) => selectedIds.has(id))
                                .length
                            }{" "}
                            {pendingBulk === "expense"
                              ? "as Expense"
                              : "as Redeployed"}
                            ?
                          </span>
                          <button
                            type="button"
                            onClick={() => applyBulkMark(pendingBulk)}
                            className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[var(--accent)]/90"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingBulk(null)}
                            className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] font-medium text-[var(--muted)] hover:bg-[var(--surface-2)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setPendingBulk("redeployed")}
                            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] font-medium text-[var(--foreground)] hover:border-[var(--accent)]"
                          >
                            Mark as Redeployed
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingBulk("expense")}
                            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[12px] font-medium text-rose-300 hover:bg-rose-500/20"
                          >
                            Mark as Expense
                          </button>
                          <button
                            type="button"
                            onClick={clearSelection}
                            className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
                          >
                            Clear
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="divide-y divide-[var(--border)]">
                  {byChain.map(({ chain, list, amount }) => (
                    <div key={chain}>
                      <div className="flex items-center justify-between bg-[var(--surface-2)]/40 px-5 py-2.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                          {chain}
                          <span className="ml-2 font-normal text-[var(--muted)]/70">
                            {list.length}{" "}
                            {list.length === 1 ? "transfer" : "transfers"}
                          </span>
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums text-[var(--foreground)]">
                          {formatUsd(amount)}
                        </span>
                      </div>
                      <div className="divide-y divide-[var(--border)]">
                        {list.map((t) => (
                          <TransferListRow
                            key={t.id}
                            transfer={t}
                            pairLabel={
                              t.transferType === "expense"
                                ? "Expense"
                                : positionPairById.get(t.positionId) ?? "—"
                            }
                            deployedLabel={
                              t.deployedToPositionId
                                ? positionPairById.get(
                                    t.deployedToPositionId,
                                  ) ?? "position"
                                : null
                            }
                            selected={selectedIds.has(t.id)}
                            onToggleSelect={toggleSelect}
                            pendingDelete={pendingDelete}
                            onDeleteRequest={setPendingDelete}
                            onDeleteConfirm={handleDelete}
                            onDeleteCancel={() => setPendingDelete(null)}
                            onEdit={(tr) =>
                              tr.transferType === "expense"
                                ? setModal({ kind: "editExpense", transfer: tr })
                                : setModal({ kind: "edit", transfer: tr })
                            }
                            onMarkDeployed={(tr) =>
                              setModal({ kind: "deploy", transfer: tr })
                            }
                            onUnlinkDeployed={handleUnlinkDeployed}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {withdrawals.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-tight">
                  Expenses &amp; Withdrawals
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Money logged out of the business — expenses and personal
                  withdrawals. Each reduces Available Balance.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Method</th>
                      <th className="px-4 py-3 text-left font-medium">Notes</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sortedWithdrawals.map((w) => (
                      <tr
                        key={w.id}
                        className="transition-colors hover:bg-[var(--surface-2)]/60"
                      >
                        <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                          {formatDateDDMMYYYY(w.date)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatUsd(w.amount)}
                        </td>
                        <td className="px-4 py-3 text-[var(--foreground)]">
                          {w.method || "—"}
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-[var(--muted)]">
                          {w.notes || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {pendingWithdrawalDelete === w.id ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="text-xs text-[var(--muted)]">
                                Delete this withdrawal?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteWithdrawal(w.id)}
                                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingWithdrawalDelete(null)}
                                className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setModal({
                                    kind: "editWithdrawal",
                                    withdrawal: w,
                                  })
                                }
                                className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingWithdrawalDelete(w.id)}
                                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
                    <tr className="font-semibold">
                      <td className="px-4 py-3">Total Withdrawn</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatUsd(balance.withdrawn)}
                      </td>
                      <td className="px-4 py-3" colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {modal.kind === "add" && (
            <TransferFormModal
              title="Add Transfer"
              submitLabel="Add Transfer"
              initial={{ ...EMPTY_FORM, date: todayDateInput() }}
              positions={positions}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={handleAdd}
            />
          )}
          {modal.kind === "edit" && (
            <TransferFormModal
              title="Edit Transfer"
              submitLabel="Save Changes"
              initial={transferToForm(modal.transfer)}
              positions={positions}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(form) => handleEdit(modal.transfer, form)}
            />
          )}
          {modal.kind === "editExpense" && (
            <ExpenseFormModal
              title="Edit Expense"
              submitLabel="Save Changes"
              initial={expenseToForm(modal.transfer)}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(form) => handleEditExpense(modal.transfer, form)}
            />
          )}
          {modal.kind === "deploy" && (
            <DeployLinkModal
              transfer={modal.transfer}
              positions={positions}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(positionId) =>
                handleMarkDeployed(modal.transfer, positionId)
              }
            />
          )}
          {modal.kind === "addWithdrawal" && (
            <WithdrawalFormModal
              title="Log an Expense"
              submitLabel="Log Expense"
              initial={{ ...EMPTY_WITHDRAWAL_FORM, date: todayDateInput() }}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={handleAddWithdrawal}
            />
          )}
          {modal.kind === "editWithdrawal" && (
            <WithdrawalFormModal
              title="Edit Withdrawal"
              submitLabel="Save Changes"
              initial={withdrawalToForm(modal.withdrawal)}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(form) => handleEditWithdrawal(modal.withdrawal, form)}
            />
          )}
        </>
      )}
    </section>
  );
}

interface GroupRow {
  key: string;
  label: string;
  count: number;
  amount: number;
}

interface GroupTableProps {
  title: string;
  subtitle: string;
  columnLabel: string;
  rows: GroupRow[];
  total: number;
}

function GroupTable({
  title,
  subtitle,
  columnLabel,
  rows,
  total,
}: GroupTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)] text-sm">
          <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{columnLabel}</th>
              <th className="px-4 py-3 text-right font-medium">Transfers</th>
              <th className="px-4 py-3 text-right font-medium">Net Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                  {row.count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatUsd(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
            <tr className="font-semibold">
              <td className="px-4 py-3">Net Total</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right tabular-nums">
                {formatUsd(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface SummaryStatProps {
  label: string;
  value: string;
  hint?: string;
}

function SummaryStat({ label, value, hint }: SummaryStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

interface BreakdownStatProps {
  breakdown: Record<TransferType, number>;
}

function BreakdownStat({ breakdown }: BreakdownStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Breakdown by Type
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(TYPE_LABELS) as TransferType[]).map((t) => (
          <div key={t} className="flex flex-col items-center">
            <div
              className={`flex h-6 w-full items-center justify-center rounded-full px-2 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ring-1 ring-inset ${TYPE_PILL[t]}`}
            >
              {SHORT_TYPE_LABELS[t]}
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums text-[var(--foreground)]">
              {breakdown[t]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TypePillProps {
  type: TransferType;
}

function TypePill({ type }: TypePillProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ring-1 ring-inset ${TYPE_PILL[type]}`}
    >
      {SHORT_TYPE_LABELS[type]}
    </span>
  );
}

interface TypeFilterToggleProps {
  value: TypeFilter;
  onChange: (next: TypeFilter) => void;
}

function TypeFilterToggle({ value, onChange }: TypeFilterToggleProps) {
  const options: Array<{ value: TypeFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "fees", label: "Fees" },
    { value: "undeployed", label: "Undeployed Tokens" },
    { value: "outOfRangeUpside", label: "Out of Range Upside" },
    { value: "expense", label: "Expenses" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Filter by transfer type"
      className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`h-8 px-3 text-xs font-medium transition-colors ${
              idx > 0 ? "border-l border-[var(--border-strong)]" : ""
            } ${
              selected
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface ModalShellProps {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}

function ModalShell({ title, onCancel, children }: ModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}

function Field({ label, htmlFor, children, hint }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 [color-scheme:dark] caret-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="px-5 py-5">
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

interface FormActionsProps {
  onCancel: () => void;
  submitLabel: string;
}

function FormActions({ onCancel, submitLabel }: FormActionsProps) {
  return (
    <div className="flex justify-end gap-2 px-5 py-4">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
      >
        {submitLabel}
      </button>
    </div>
  );
}

interface TransferFormModalProps {
  title: string;
  submitLabel: string;
  initial: TransferFormState;
  positions: Position[];
  onCancel: () => void;
  onSubmit: (form: TransferFormState) => void;
}

function TransferFormModal({
  title,
  submitLabel,
  initial,
  positions,
  onCancel,
  onSubmit,
}: TransferFormModalProps) {
  const [form, setForm] = useState<TransferFormState>(initial);

  const set = <K extends keyof TransferFormState>(
    key: K,
    value: TransferFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const upper =
    (key: keyof TransferFormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, e.target.value.toUpperCase() as TransferFormState[typeof key]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Transfer Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PositionCombobox
              positions={positions}
              value={form.positionId}
              onChange={(v) => set("positionId", v)}
            />
            <Field label="Date" htmlFor="date">
              <input
                id="date"
                type="date"
                required
                className={inputClass}
                style={{ colorScheme: "dark" }}
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label="Token" htmlFor="token">
              <input
                id="token"
                required
                className={inputClass}
                placeholder="ETH"
                value={form.token}
                onChange={upper("token")}
              />
            </Field>
            <Field label="Amount" htmlFor="amount">
              <input
                id="amount"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
            <Field
              label="Platform (from)"
              htmlFor="platform"
              hint="Where the money came from."
            >
              <input
                id="platform"
                required
                className={inputClass}
                placeholder="AAVE"
                value={form.platform}
                onChange={upper("platform")}
              />
            </Field>
            <Field
              label="Destination (to)"
              htmlFor="destination"
              hint="Where you moved it — optional."
            >
              <input
                id="destination"
                className={inputClass}
                placeholder="RAKA"
                value={form.destination}
                onChange={upper("destination")}
              />
            </Field>
            <Field label="Transfer Type" htmlFor="transferType">
              <TypeSegmentedToggle
                value={form.transferType}
                onChange={(v) => set("transferType", v)}
              />
            </Field>
            {/* Undeployed Tokens are idle capital — not yet redeployed OR spent
                — so no Money Status is asked at logging time (Part 3). It stays
                idle until marked deployed or edited to an expense later. */}
            {form.transferType !== "undeployed" && (
              <Field
                label="Money Status"
                htmlFor="moneyStatus"
                hint="Redeployed = still working in the business (e.g. moved to AAVE). Expense = money that has left the business. Only expenses reduce Overall P&L."
              >
                <MoneyStatusToggle
                  value={form.moneyStatus}
                  onChange={(v) => set("moneyStatus", v)}
                />
              </Field>
            )}
          </div>
          <div className="mt-4">
            <Field label="Notes" htmlFor="notes">
              <textarea
                id="notes"
                rows={2}
                className={inputClass}
                value={form.notes}
                onChange={upper("notes")}
              />
            </Field>
          </div>
        </Section>
        <FormActions onCancel={onCancel} submitLabel={submitLabel} />
      </form>
    </ModalShell>
  );
}

interface WithdrawalFormModalProps {
  title: string;
  submitLabel: string;
  initial: WithdrawalFormState;
  onCancel: () => void;
  onSubmit: (form: WithdrawalFormState) => void;
}

function WithdrawalFormModal({
  title,
  submitLabel,
  initial,
  onCancel,
  onSubmit,
}: WithdrawalFormModalProps) {
  const [form, setForm] = useState<WithdrawalFormState>(initial);

  const set = <K extends keyof WithdrawalFormState>(
    key: K,
    value: WithdrawalFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Expense / Withdrawal Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="w_date">
              <input
                id="w_date"
                type="date"
                required
                className={inputClass}
                style={{ colorScheme: "dark" }}
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label="Amount (USD)" htmlFor="w_amount">
              <input
                id="w_amount"
                type="number"
                step="any"
                required
                className={inputClass}
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
            <Field
              label="Method / Category (optional)"
              htmlFor="w_method"
              hint="e.g. Rent, Bank, Personal Wallet."
            >
              <input
                id="w_method"
                className={inputClass}
                placeholder="RENT"
                value={form.method}
                onChange={(e) => set("method", e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Notes" htmlFor="w_notes">
              <textarea
                id="w_notes"
                rows={2}
                className={inputClass}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </Section>
        <FormActions onCancel={onCancel} submitLabel={submitLabel} />
      </form>
    </ModalShell>
  );
}

// Minimal modal for position-less expenses — Date, Amount, Notes only.
// moneyStatus/transferType are set to "expense" by buildExpense, not the user.
// Picks the position a Redeployed transfer's money went into (Part 2). All
// positions are offered — usually a new active one, but a top-up into any
// existing position is valid, so we don't over-restrict; active are listed
// first, closed labelled. Confirming records the link; the position itself is
// never modified.
function DeployLinkModal({
  transfer,
  positions,
  onCancel,
  onSubmit,
}: {
  transfer: Transfer;
  positions: Position[];
  onCancel: () => void;
  onSubmit: (positionId: string) => void;
}) {
  const [positionId, setPositionId] = useState(
    transfer.deployedToPositionId ?? "",
  );
  const sorted = [...positions].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.pair.localeCompare(b.pair);
  });
  return (
    <ModalShell title="Mark as deployed" onCancel={onCancel}>
      <Section title="Deploy into a position">
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted)]">
          Link this {formatUsd(transfer.amount)} transfer to the position its
          money went into. It stays in the list but leaves Available Balance
          until you undo. The position&apos;s own Deposited figure is unchanged
          — you entered that separately when you opened it.
        </p>
        <Field label="Position" htmlFor="deploy-position">
          <select
            id="deploy-position"
            required
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            className={inputClass}
          >
            <option value="">— Select position —</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.pair}
                {p.status === "closed" ? " (closed)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </Section>
      <div className="flex justify-end gap-2 px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={positionId === ""}
          onClick={() => onSubmit(positionId)}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm
        </button>
      </div>
    </ModalShell>
  );
}

function ExpenseFormModal({
  title,
  submitLabel,
  initial,
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial: ExpenseFormState;
  onCancel: () => void;
  onSubmit: (form: ExpenseFormState) => void;
}) {
  const [form, setForm] = useState<ExpenseFormState>(initial);

  const set = <K extends keyof ExpenseFormState>(
    key: K,
    value: ExpenseFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Expense Details">
          <p className="mb-4 text-[11px] text-[var(--muted)]">
            Money that has left the business (rent, subscriptions, etc.). No
            position or chain needed — it draws from one overall pool and
            subtracts from Overall P&amp;L.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="e_date">
              <input
                id="e_date"
                type="date"
                required
                className={inputClass}
                style={{ colorScheme: "dark" }}
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label="Amount (USD)" htmlFor="e_amount">
              <input
                id="e_amount"
                type="number"
                step="any"
                required
                className={inputClass}
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field
              label="Notes (reason)"
              htmlFor="e_notes"
              hint="What the expense was for."
            >
              <textarea
                id="e_notes"
                rows={2}
                className={inputClass}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </Section>
        <FormActions onCancel={onCancel} submitLabel={submitLabel} />
      </form>
    </ModalShell>
  );
}

function MoneyStatusToggle({
  value,
  onChange,
}: {
  value: MoneyStatus;
  onChange: (next: MoneyStatus) => void;
}) {
  const options: Array<{ value: MoneyStatus; label: string }> = [
    { value: "redeployed", label: "Redeployed" },
    { value: "expense", label: "Expense" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Money status"
      className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        const selectedClass =
          opt.value === "expense"
            ? "bg-rose-500 text-white"
            : "bg-[var(--accent)] text-white";
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`h-9 px-3 text-xs font-medium transition-colors ${
              idx > 0 ? "border-l border-[var(--border-strong)]" : ""
            } ${
              selected
                ? selectedClass
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MoneyStatusPill({ status }: { status: Transfer["moneyStatus"] }) {
  if (status === "expense") {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-300">
        Expense
      </span>
    );
  }
  // Unset = an Undeployed Tokens transfer sitting idle (not yet redeployed or
  // spent). "Needs Review" was retired, so fees/upside are always redeployed.
  if (status === undefined) {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-300">
        Idle
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
      Redeployed
    </span>
  );
}

interface TypeSegmentedToggleProps {
  value: TransferType;
  onChange: (next: TransferType) => void;
}

function TypeSegmentedToggle({ value, onChange }: TypeSegmentedToggleProps) {
  const options: Array<{ value: TransferType; label: string }> = [
    { value: "fees", label: "Fees" },
    { value: "undeployed", label: "Undeployed Tokens" },
    { value: "outOfRangeUpside", label: "Out of Range Upside" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Transfer type"
      className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`h-9 px-3 text-xs font-medium transition-colors ${
              idx > 0 ? "border-l border-[var(--border-strong)]" : ""
            } ${
              selected
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyIcon() {
  return (
    <svg
      className="mx-auto h-10 w-10 text-[var(--muted)]/60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path d="M5 7l7-4 7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const backfillDateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatBackfillDate(iso: string): string {
  const d = new Date((iso ?? "").slice(0, 10));
  return Number.isNaN(d.getTime()) ? iso : backfillDateFmt.format(d);
}

// One-line preview of what a claim's auto transfer(s) will look like, without
// fetching prices (the dual-token split resolves on confirm).
function claimPreview(claim: FeeClaim): string {
  const built = buildClaimTransfers(claim);
  if (built.needsPrices) {
    return `2 transfers · ${built.dualSymbols.join(" + ")} split by price on ${formatBackfillDate(
      claim.date,
    )}`;
  }
  const t = built.transfers[0];
  return t ? `${formatUsd(t.amount)} · ${t.token}` : "—";
}

interface BackfillReviewProps {
  claims: FeeClaim[];
  positions: Position[];
  transfers: Transfer[];
  onDone: () => void;
}

// Safe, reviewable backfill of historical fee claims and above-range closes.
// Never writes without an explicit confirmation, and only lists records that
// have no matching transfer yet (dedup by sourceClaimId/sourceCloseId, or the
// position+day+type heuristic), so re-running cannot create duplicates.
function BackfillReview({
  claims,
  positions,
  transfers,
  onDone,
}: BackfillReviewProps) {
  const [excludedClaims, setExcludedClaims] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const eligibleClaims = useMemo(
    () => eligibleClaimsForBackfill(claims, transfers),
    [claims, transfers],
  );
  const eligibleCloses = useMemo(
    () => eligibleClosesForBackfill(positions, transfers),
    [positions, transfers],
  );

  if (eligibleClaims.length === 0 && eligibleCloses.length === 0) return null;

  const toInclude = eligibleClaims.filter((c) => !excludedClaims.has(c.id));

  const toggleClaim = (id: string) =>
    setExcludedClaims((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runClaimBackfill = async () => {
    setBusy(true);
    for (const c of toInclude) {
      // reconcile keys off sourceClaimId; these are eligible (none), so it
      // creates. Sequential so the dual-token price fetches don't stampede.
      await reconcileClaimTransfers(c);
    }
    setBusy(false);
    setExcludedClaims(new Set());
    onDone();
  };

  const confirmClose = (p: Position) => {
    createUpsideTransfer(p);
    onDone();
  };

  return (
    <div className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-amber-200">
          Backfill transfers from history
        </h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Records with no matching transfer yet. Nothing is created until you
          confirm — anything already covered by a transfer is hidden, so this
          can&apos;t make duplicates.
        </p>
      </div>

      {eligibleClaims.length > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Fee claims ({eligibleClaims.length})
            </h3>
            <button
              type="button"
              disabled={busy || toInclude.length === 0}
              onClick={() => void runClaimBackfill()}
              className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--accent)]/90 disabled:opacity-50"
            >
              {busy
                ? "Creating…"
                : `Create ${toInclude.length} transfer${toInclude.length === 1 ? "" : "s"}`}
            </button>
          </div>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {eligibleClaims.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!excludedClaims.has(c.id)}
                    onChange={() => toggleClaim(c.id)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="text-[var(--foreground)]">
                    {c.pair || "—"}
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">
                    {formatBackfillDate(c.date)}
                  </span>
                </label>
                <span className="text-[11px] tabular-nums text-[var(--muted)]">
                  {claimPreview(c)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {eligibleCloses.length > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Above-range closes to confirm ({eligibleCloses.length})
          </h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Exit side can&apos;t be detected from stored data — confirm only the
            positions you closed <em>above</em> range. Their scalp is set aside
            as an Out-of-Range-Upside transfer.
          </p>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {eligibleCloses.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span>
                  <span className="text-[var(--foreground)]">{p.pair}</span>{" "}
                  <span className="text-[11px] text-[var(--muted)]">
                    closed {formatBackfillDate(p.exitDatetime ?? "")} · scalp{" "}
                    {formatUsd(p.scalp ?? 0)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => confirmClose(p)}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)]"
                >
                  Yes, above range → set aside {formatUsd(p.scalp ?? 0)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
