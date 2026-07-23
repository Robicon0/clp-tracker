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
  getPositions,
  getSettings,
  getTransfers,
  getWithdrawals,
  saveTransfers,
  saveWithdrawals,
} from "../../lib/storage";
import { countUnclassifiedTransfers } from "../../lib/calculations";
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
};

const SHORT_TYPE_LABELS: Record<TransferType, string> = {
  fees: "Fees",
  undeployed: "Undeployed",
  outOfRangeUpside: "OOR Upside",
};

const TYPE_PILL: Record<TransferType, string> = {
  fees: "bg-blue-500/10 text-blue-300 ring-blue-500/30",
  undeployed: "bg-purple-500/10 text-purple-300 ring-purple-500/30",
  outOfRangeUpside: "bg-orange-500/10 text-orange-300 ring-orange-500/30",
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const tokenFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function formatUsd(value: number): string {
  return usdFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatToken(value: number): string {
  return tokenFormatter.format(Number.isFinite(value) ? value : 0);
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
    moneyStatus: form.moneyStatus,
    notes: form.notes.trim().toUpperCase(),
  };
}

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; transfer: Transfer }
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

export default function TransfersPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingWithdrawalDelete, setPendingWithdrawalDelete] = useState<
    string | null
  >(null);

  const refresh = () => {
    setSettings(getSettings());
    setTransfers(getTransfers());
    setWithdrawals(getWithdrawals());
    setPositions(getPositions());
    setClaims(getClaims());
  };

  const hydrated = useHydrated(refresh);

  const positionPairById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of positions) map.set(p.id, p.pair);
    return map;
  }, [positions]);

  // Transfers logged before Money Status existed. They behave as Redeployed
  // everywhere, so nothing is wrong until the user says otherwise — this just
  // surfaces them for a one-time pass.
  const unclassifiedCount = useMemo(
    () => (hydrated ? countUnclassifiedTransfers(transfers) : 0),
    [hydrated, transfers],
  );

  const sortedFiltered = useMemo(() => {
    if (!hydrated) return [];
    const byType = transfers.filter((t) =>
      typeFilter === "all" ? true : t.transferType === typeFilter,
    );
    const filtered = reviewOnly
      ? byType.filter((t) => t.moneyStatus === undefined)
      : byType;
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [hydrated, transfers, typeFilter, reviewOnly]);

  const totals = useMemo(() => {
    let amount = 0;
    const breakdown: Record<TransferType, number> = {
      fees: 0,
      undeployed: 0,
      outOfRangeUpside: 0,
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
      const token = t.token || "—";
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

  // Balance ledger (Money Flow invariant): Lifetime Earned = Σ transfers
  // (every fee moved to a destination), Withdrawn = Σ withdrawals taken out
  // for personal use, Available Balance = the difference. Withdrawals never
  // reduce Lifetime Earned — only what's still available.
  const balance = useMemo(() => {
    const lifetimeEarned = transfers.reduce((sum, t) => sum + t.amount, 0);
    const withdrawn = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    return {
      lifetimeEarned,
      withdrawn,
      available: lifetimeEarned - withdrawn,
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
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModal({ kind: "addWithdrawal" })}
              className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)]"
            >
              Record Withdrawal
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

          {/* Money Flow ledger: earned (grows forever) − withdrawn = available now. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryStat
              label="Lifetime Earned (USD)"
              value={formatUsd(balance.lifetimeEarned)}
              hint="Everything ever moved to a destination — never decreases."
            />
            <SummaryStat
              label="Withdrawn (USD)"
              value={formatUsd(balance.withdrawn)}
              hint="Money taken out for personal / other use."
            />
            <SummaryStat
              label="Available Balance (USD)"
              value={formatUsd(balance.available)}
              hint="Lifetime Earned − Withdrawn = what you have now."
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

          {unclassifiedCount > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-5 py-4">
              <p className="text-[13px] text-amber-300">
                {unclassifiedCount}{" "}
                {unclassifiedCount === 1 ? "transfer was" : "transfers were"}{" "}
                logged before expense tracking existed and default to
                Redeployed — review and reclassify any that were actually
                expenses.
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Until reclassified they have no effect on Overall P&amp;L, so
                nothing is being counted as a loss.
              </p>
              <button
                type="button"
                onClick={() => setReviewOnly((v) => !v)}
                className="mt-2 rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/10"
              >
                {reviewOnly ? "Show all transfers" : "Show only these"}
              </button>
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                All Transfers
                {reviewOnly && (
                  <span className="ml-2 text-[11px] font-normal text-amber-300">
                    showing unreviewed only
                  </span>
                )}
              </h2>
              <TypeFilterToggle value={typeFilter} onChange={setTypeFilter} />
            </div>

            {sortedFiltered.length === 0 ? (
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
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Position
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Token</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Platform
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Destination
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Transfer Type
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Money Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Notes</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sortedFiltered.map((t) => (
                      <tr
                        key={t.id}
                        className="transition-colors hover:bg-[var(--surface-2)]/60"
                      >
                        <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                          {formatDateDDMMYYYY(t.date)}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                          {positionPairById.get(t.positionId) ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {t.token}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatToken(t.amount)}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {t.platform}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                          {t.destination || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <TypePill type={t.transferType} />
                        </td>
                        <td className="px-4 py-3">
                          <MoneyStatusPill status={t.moneyStatus} />
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)] max-w-xs truncate">
                          {t.notes || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {pendingDelete === t.id ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="text-xs text-[var(--muted)]">
                                Delete this transfer?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDelete(t.id)}
                                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
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
                                  setModal({ kind: "edit", transfer: t })
                                }
                                className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(t.id)}
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
                </table>
              </div>
            )}
          </div>

          {withdrawals.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-tight">
                  Withdrawals
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Money taken out of the business for personal or other use.
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
          {modal.kind === "addWithdrawal" && (
            <WithdrawalFormModal
              title="Record Withdrawal"
              submitLabel="Record Withdrawal"
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
      <div className="mt-2 grid grid-cols-3 gap-3">
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ring-1 ring-inset ${TYPE_PILL[type]}`}
    >
      {TYPE_LABELS[type]}
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
            <Field label="Position" htmlFor="positionId">
              <select
                id="positionId"
                required
                value={form.positionId}
                onChange={(e) => set("positionId", e.target.value)}
                className={inputClass}
              >
                <option value="">— Select position —</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pair} · {p.chain}
                  </option>
                ))}
              </select>
            </Field>
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
            <Field label="Transfer Type" htmlFor="transferType">
              <TypeSegmentedToggle
                value={form.transferType}
                onChange={(v) => set("transferType", v)}
              />
            </Field>
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
        <Section title="Withdrawal Details">
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
              label="Method"
              htmlFor="w_method"
              hint="Where it went — Bank, Personal Wallet, etc."
            >
              <input
                id="w_method"
                className={inputClass}
                placeholder="BANK"
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
  if (status === "redeployed") {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Redeployed
      </span>
    );
  }
  // Never classified — shown distinctly so the review list is obvious.
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
      Needs review
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
