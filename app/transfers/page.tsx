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
  getDeletedTransfers,
  getOutlierDismissals,
  getPositions,
  getSettings,
  getTransfers,
  getWithdrawals,
  migrateTransferMoneyStatus,
  purgeTransfer,
  restoreTransfer,
  saveOutlierDismissals,
  saveTransfers,
  saveWithdrawals,
  softDeleteTransfer,
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
  applyRevertToAuto,
  buildClaimTransfers,
  createUpsideTransfer,
  eligibleClaimsForBackfill,
  eligibleClosesForBackfill,
  isAutoCreated,
  planRevertToAuto,
  reconcileClaimTransfers,
  type AutoRevertPlan,
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

// ── Where a transfer's money currently sits ─────────────────────────────
// Every transfer is in exactly ONE of four states, and the four predicates
// below are mutually exclusive BY CONSTRUCTION (each one re-tests the states
// above it in the precedence order). That is what makes it impossible for a
// single amount to be subtracted from Available Balance twice — the reason
// the order is written out rather than left implicit:
//
//   1. Expense     — moneyStatus "expense": the money has left the business.
//   2. Deployed    — deployedToPositionId set: it now lives inside a position.
//   3. Transferred — a non-blank Platform: sent somewhere for yield (AAVE …).
//   4. Idle        — none of the above: still sitting in Available Balance.
//
// "Transferred" is DERIVED from platform rather than stored as a new flag:
// the Platform field already means "this money is sitting at X", the Edit
// form has always written it, and a derived state needs no schema change and
// no migration — an existing record with a platform is Transferred the moment
// this ships (the deliberate balance change, see CLAUDE.md).
//
// Note the states are keyed off platform/deploy-link, NOT off moneyStatus
// "redeployed" specifically: an idle Undeployed Tokens transfer carries an
// UNSET moneyStatus (d20f3e3) and must be able to reach Transferred too.
// Sentinel deployedToPositionId for "I know this money went into a position,
// I just can't remember which". It deliberately reuses the SAME field rather
// than adding a flag, so every presence-based reader — the Deployed bucket in
// the balance memo, isDeployedTransfer, isUntouchedAuto — treats it exactly
// like a real link with no changes at all. Only the label lookups need to know
// about it. The double-underscore form cannot collide with a stored position id
// (those are crypto.randomUUID values).
const UNKNOWN_POSITION_ID = "__unknown_position__";

function isExpensedTransfer(t: Transfer): boolean {
  return t.moneyStatus === "expense";
}
function isDeployedTransfer(t: Transfer): boolean {
  return !isExpensedTransfer(t) && t.deployedToPositionId !== undefined;
}
function isTransferredToPlatform(t: Transfer): boolean {
  return (
    !isExpensedTransfer(t) &&
    !isDeployedTransfer(t) &&
    (t.platform ?? "").trim() !== ""
  );
}
// Idle money is the only kind that can still be sent somewhere: not spent, not
// already inside a position, not already sitting at a platform.
function isIdleTransfer(t: Transfer): boolean {
  return (
    !isExpensedTransfer(t) &&
    !isDeployedTransfer(t) &&
    !isTransferredToPlatform(t)
  );
}

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; transfer: Transfer }
  | { kind: "editExpense"; transfer: Transfer }
  | { kind: "deploy"; transfer: Transfer }
  | { kind: "platform"; transfer: Transfer }
  | { kind: "revert"; transfer: Transfer }
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
  onSendToPlatform,
  onRemovePlatform,
  onRevertToAuto,
  datesLabel,
}: {
  transfer: Transfer;
  pairLabel: string;
  deployedLabel: string | null;
  // Replaces the row's single bare date when one date can't tell the whole
  // story — an Out-of-Range-Upside transfer belongs to a position CLOSE, so it
  // shows that position's opened AND closed dates instead.
  datesLabel: string | null;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  pendingDelete: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  onEdit: (t: Transfer) => void;
  onMarkDeployed: (t: Transfer) => void;
  onUnlinkDeployed: (t: Transfer) => void;
  onSendToPlatform: (t: Transfer) => void;
  onRemovePlatform: (t: Transfer) => void;
  onRevertToAuto: (t: Transfer) => void;
}) {
  // Every row starts collapsed, in every view. Expansion is only ever driven by
  // this row's own two controls — its checkbox and its header toggle. Nothing
  // about the filter state opens rows any more: auto-expanding a whole filtered
  // list (170b669) turned out to be too much at once in real use.
  const [open, setOpen] = useState(false);
  // Settled money is visually locked (dimmed). THREE states count as settled
  // and read identically — "this money has been put to use": a deploy-link
  // (inside a position), a platform (sent out for yield) and an Expense
  // status (left the business). None of them is idle any more. Changing any
  // of them still requires an explicit click in the expanded row.
  const isExpensed = isExpensedTransfer(t);
  const isDeployed = isDeployedTransfer(t);
  const isTransferred = isTransferredToPlatform(t);
  const isSettled = isDeployed || isExpensed || isTransferred;
  // Deploy-linking is available on ANY transfer whose money is still available
  // — Fees, Out of Range Upside and idle Undeployed Tokens alike. It is NOT
  // gated by transferType (measured live 2026-07-30: all three types offer it).
  // The one state that hides it is Expense — that money has left the business,
  // so there is nothing left to deploy.
  const canDeploy =
    t.transferType !== "expense" &&
    (t.moneyStatus === "redeployed" || t.moneyStatus === undefined);
  // Sending to a platform is gated exactly like deploy-linking: available on
  // Fees, Out of Range Upside and Undeployed Tokens alike (never by type), and
  // hidden only once the money has been expensed.
  const canSendToPlatform = canDeploy;
  return (
    <div
      className={`${selected ? "bg-[var(--accent)]/[0.06]" : ""} ${
        isSettled ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        {/* The checkbox carries the expansion with it: checking a row opens it
            (if you are singling a row out you want to see what it is) and
            unchecking closes it again, so selecting and de-selecting leaves the
            list exactly as it found it. The header toggle still works for a
            look without selecting. Deliberately NOT wired to "select all
            visible" — that would re-create the bulk expansion just removed. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {
            setOpen(!selected);
            onToggleSelect(t.id);
          }}
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
              <span className="tabular-nums">
                {datesLabel ?? formatDateDDMMYYYY(t.date)}
              </span>
              <TypePill type={t.transferType} />
              <MoneyStatusPill status={t.moneyStatus} />
              {deployedLabel && (
                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                  Used → {deployedLabel}
                </span>
              )}
              {/* The Transferred badge supersedes the Money Status pill for an
                  idle Undeployed row, which would otherwise still read "Idle"
                  after its money was sent to a platform. */}
              {isTransferred && (
                <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
                  Sent → {t.platform}
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
                  Delete this transfer? You can restore it from Recently
                  Deleted.
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
                {/* Deploy-linking applies to every still-available transfer
                    (Fees, Out of Range Upside, idle Undeployed Tokens) — never
                    to money already marked as an Expense. */}
                {canDeploy &&
                  (t.deployedToPositionId ? (
                    <>
                      {/* A deploy-link is changeable, not just removable —
                          that is what makes "Unknown position" safe to pick:
                          you can name the position later without unlinking
                          and re-linking. */}
                      <button
                        type="button"
                        onClick={() => onMarkDeployed(t)}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Change position
                      </button>
                      <button
                        type="button"
                        onClick={() => onUnlinkDeployed(t)}
                        className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                      >
                        Remove deploy link
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMarkDeployed(t)}
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Mark as deployed
                    </button>
                  ))}
                {/* Send to Platform — the same availability rule as deploying,
                    so Fees, Out of Range Upside and Undeployed Tokens all get
                    it. Removing the platform returns the money to Available. */}
                {canSendToPlatform && (
                  <button
                    type="button"
                    onClick={() => onSendToPlatform(t)}
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
                  >
                    {isTransferred ? "Change platform" : "Send to Platform"}
                  </button>
                )}
                {/* Only automation-created rows have an auto state to go back
                    to; a hand-logged transfer has none, so it never offers
                    this. */}
                {isAutoCreated(t) && (
                  <button
                    type="button"
                    onClick={() => onRevertToAuto(t)}
                    className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
                  >
                    Revert to auto-created
                  </button>
                )}
                {canSendToPlatform && isTransferred && (
                  <button
                    type="button"
                    onClick={() => onRemovePlatform(t)}
                    className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                  >
                    Remove platform
                  </button>
                )}
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
          {/* Why "Mark as deployed" is absent here, said out loud — the action
              vanishing silently is what made this look like a per-type bug. */}
          {isExpensed && t.transferType !== "expense" && (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Marked as an Expense, so this money has left the business and
              can&apos;t be deployed. Undo the Expense — in Edit, or with the
              bulk action above — to make it available again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Recently Deleted: the safety net for the Delete action. Collapsed by default
// and styled like the Show/Hide Closed Positions toggle, so it reads as the
// same "there is more below" affordance. Deleted transfers are kept
// indefinitely — no expiry sweep — because this is financial history; the only
// way a record actually leaves storage is the Permanently delete action here,
// which is separately labelled and needs its own confirm.
function RecentlyDeletedSection({
  rows,
  open,
  onToggle,
  pairLabelFor,
  deployedLabelFor,
  pendingPurge,
  onPurgeRequest,
  onPurgeConfirm,
  onPurgeCancel,
  onRestore,
}: {
  rows: Transfer[];
  open: boolean;
  onToggle: () => void;
  pairLabelFor: (t: Transfer) => string;
  deployedLabelFor: (t: Transfer) => string;
  pendingPurge: string | null;
  onPurgeRequest: (id: string) => void;
  onPurgeConfirm: (id: string) => void;
  onPurgeCancel: () => void;
  onRestore: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-[var(--border)] px-5 py-4 text-left transition-colors hover:bg-[var(--surface-2)]/50"
      >
        <span className="text-sm font-semibold tracking-tight">
          {open ? "Hide" : "Show"} Recently Deleted ({rows.length})
        </span>
        <span className="text-xs text-[var(--muted)]" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <>
          <p className="px-5 pt-4 text-[11px] leading-relaxed text-[var(--muted)]">
            These transfers are hidden from every list, total and balance, but
            nothing has been lost — Restore brings a record back exactly as it
            was. They are kept indefinitely.
          </p>
          <div className="mt-3 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {rows.map((t) => (
              <div key={t.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {pairLabelFor(t)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                      <span className="tabular-nums">
                        {formatDateDDMMYYYY(t.date)}
                      </span>
                      <TypePill type={t.transferType} />
                      <MoneyStatusPill status={t.moneyStatus} />
                      <span>Deleted {formatDateDDMMYYYY(t.deletedAt ?? "")}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--foreground)]">
                    {formatUsd(t.amount)}
                  </span>
                </div>
                {/* Everything the record still holds, shown so the user can see
                    nothing was stripped while it sat in here. */}
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <div>
                    <dt className="uppercase tracking-wider text-[var(--muted)]">
                      Platform
                    </dt>
                    <dd className="text-[var(--foreground)]">
                      {t.platform || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wider text-[var(--muted)]">
                      Destination
                    </dt>
                    <dd className="text-[var(--foreground)]">
                      {t.destination || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wider text-[var(--muted)]">
                      Token
                    </dt>
                    <dd className="text-[var(--foreground)]">
                      {t.token || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wider text-[var(--muted)]">
                      Deployed to
                    </dt>
                    <dd className="text-[var(--foreground)]">
                      {deployedLabelFor(t)}
                    </dd>
                  </div>
                </dl>
                {t.notes && (
                  <p className="mt-2 text-[12px] text-[var(--muted)]">
                    {t.notes}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {pendingPurge === t.id ? (
                    <>
                      <span className="text-xs text-rose-300">
                        Permanently delete this transfer? This cannot be undone.
                      </span>
                      <button
                        type="button"
                        onClick={() => onPurgeConfirm(t.id)}
                        className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                      >
                        Yes, delete forever
                      </button>
                      <button
                        type="button"
                        onClick={onPurgeCancel}
                        className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onRestore(t.id)}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => onPurgeRequest(t.id)}
                        className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                      >
                        Permanently delete
                      </button>
                      <span className="text-[11px] text-[var(--muted)]">
                        Permanent deletion cannot be undone.
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
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
  const [positionFilter, setPositionFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bulk marking has two scopes: the checkbox selection, and "all N shown"
  // (Part 4) which needs no selection once the list is narrowed to a position.
  const [pendingBulk, setPendingBulk] = useState<{
    status: MoneyStatus;
    scope: "selected" | "visible";
  } | null>(null);
  // Bulk "send all shown to platform" (Part 3): the typed platform plus its
  // own confirm step, kept separate from pendingBulk so the two bulk actions
  // can never fire each other's confirm.
  const [bulkPlatform, setBulkPlatform] = useState("");
  const [pendingBulkPlatform, setPendingBulkPlatform] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingWithdrawalDelete, setPendingWithdrawalDelete] = useState<
    string | null
  >(null);

  const [dismissals, setDismissals] = useState<OutlierDismissal[]>([]);
  // Recently Deleted: soft-deleted transfers, collapsed by default, plus the
  // two-step confirm for the one action that is genuinely irreversible.
  const [deletedTransfers, setDeletedTransfers] = useState<Transfer[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [pendingPurge, setPendingPurge] = useState<string | null>(null);

  const refresh = () => {
    setSettings(getSettings());
    setTransfers(getTransfers());
    setDeletedTransfers(getDeletedTransfers());
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

  const positionById = useMemo(() => {
    const map = new Map<string, Position>();
    for (const p of positions) map.set(p.id, p);
    return map;
  }, [positions]);

  // An Out-of-Range-Upside transfer is the profit from ONE position close, so a
  // single unlabelled date (the close day) can't say which close it came from —
  // especially on a pair that has been opened and closed more than once. Show
  // the linked position's own opened and closed dates instead. Falls back to
  // the plain transfer date if the position is gone or somehow still open.
  const upsideDatesLabel = (t: Transfer): string | null => {
    if (t.transferType !== "outOfRangeUpside") return null;
    const p = positionById.get(t.sourceCloseId ?? t.positionId);
    if (!p) return null;
    const opened = `Opened ${formatDateDDMMYYYY(p.entryDatetime)}`;
    if (!p.exitDatetime) return opened;
    return `${opened} · Closed ${formatDateDDMMYYYY(p.exitDatetime)}`;
  };

  // Positions that already hold deployed money, for the Mark as Deployed
  // picker. Counted exactly like the Deployed balance card (expense-marked rows
  // are excluded — that money left the business), so the two always agree.
  const deployedByPosition = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const t of transfers) {
      if (!isDeployedTransfer(t) || !t.deployedToPositionId) continue;
      const entry = map.get(t.deployedToPositionId) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += t.amount;
      map.set(t.deployedToPositionId, entry);
    }
    return map;
  }, [transfers]);

  // Positions whose fee money is entirely gone: EVERY transfer belonging to the
  // position is Expense-status. One non-expense transfer (redeployed, deployed
  // or transferred) disqualifies it — partial expensing is not "fully", and a
  // position with no transfers at all cannot be fully anything, so both are
  // excluded by construction (the counter only records ids it has seen).
  const fullyExpensedPositions = useMemo(() => {
    const tally = new Map<string, { total: number; expensed: number }>();
    for (const t of transfers) {
      if (!t.positionId) continue;
      const entry = tally.get(t.positionId) ?? { total: 0, expensed: 0 };
      entry.total += 1;
      if (isExpensedTransfer(t)) entry.expensed += 1;
      tally.set(t.positionId, entry);
    }
    const ids = new Set<string>();
    for (const [id, { total, expensed }] of tally) {
      if (total > 0 && total === expensed) ids.add(id);
    }
    return ids;
  }, [transfers]);

  // The picker annotation. Fully-expensed wins the slot when both could apply:
  // "this position's money is all spent" is the more important warning, and in
  // practice they are mutually exclusive anyway — deployed money is by
  // definition not expensed, so a position holding deployed money always has at
  // least one non-expense transfer.
  const positionNote = (
    p: Position,
  ): { text: string; tone: "muted" | "danger" } | null => {
    if (fullyExpensedPositions.has(p.id)) {
      return { text: "fully expensed", tone: "danger" };
    }
    const already = deployedByPosition.get(p.id);
    if (already) {
      return {
        text: `already has ${formatUsd(already.amount)} deployed`,
        tone: "muted",
      };
    }
    return null;
  };

  // One place decides what a deploy-link is called, so the row badge and the
  // Recently Deleted entry can never word it differently. The unknown sentinel
  // has no pair to look up and says so rather than implying a position.
  const deployedLabelOf = (t: Transfer): string | null => {
    if (!t.deployedToPositionId) return null;
    if (t.deployedToPositionId === UNKNOWN_POSITION_ID) return "Unknown position";
    return positionPairById.get(t.deployedToPositionId) ?? "position";
  };

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
    const filtered = transfers.filter(
      (t) =>
        (typeFilter === "all" ? true : t.transferType === typeFilter) &&
        (positionFilter === "" ? true : t.positionId === positionFilter),
    );
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [hydrated, transfers, typeFilter, positionFilter]);

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

  // Only idle rows are eligible for the bulk send — money already deployed,
  // expensed or sitting at a platform is not "currently idle" and is left
  // alone (a single row can still be re-platformed via Change platform).
  const bulkPlatformTargets = useMemo(
    () => searchedFiltered.filter(isIdleTransfer),
    [searchedFiltered],
  );

  // Platforms already used anywhere, offered as autocomplete so the same
  // destination doesn't end up spelled three ways.
  const knownPlatforms = useMemo(
    () =>
      [
        ...new Set(
          transfers.map((t) => (t.platform ?? "").trim()).filter((p) => p !== ""),
        ),
      ].sort(),
    [transfers],
  );

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
    setPendingBulkPlatform(false);
  };

  // The only new way data changes here (Part 4): set moneyStatus on every
  // selected+visible transfer at once, behind an explicit confirm. transferType
  // is untouched — Overall P&L counts expenses by moneyStatus alone.
  const applyBulkMark = (status: MoneyStatus, scope: "selected" | "visible") => {
    const targetIds = new Set(
      scope === "visible"
        ? visibleIds
        : visibleIds.filter((id) => selectedIds.has(id)),
    );
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
    // buildTransfer only knows the form's fields, so the record's out-of-form
    // links have to be carried across by hand: the automation idempotency ids
    // and the deploy-link. Without this, editing a deployed transfer (e.g. to
    // mark it as an Expense — Part 6) silently dropped its deploy-link and its
    // sourceClaimId, which would let a backfill re-create the same transfer.
    const updated: Transfer = {
      ...buildTransfer(target.id, form),
      ...(target.sourceClaimId !== undefined
        ? { sourceClaimId: target.sourceClaimId }
        : {}),
      ...(target.sourceCloseId !== undefined
        ? { sourceCloseId: target.sourceCloseId }
        : {}),
      ...(target.deployedToPositionId !== undefined
        ? {
            deployedToPositionId: target.deployedToPositionId,
            deployedAt: target.deployedAt,
          }
        : {}),
    };
    saveTransfers(
      getTransfers().map((t) => (t.id === target.id ? updated : t)),
    );
    refresh();
    setModal({ kind: "none" });
  };

  // Deleting is now reversible: the record keeps every field and simply drops
  // out of the live list (and therefore out of every total and balance) until
  // it is restored or explicitly purged.
  const handleDelete = (id: string) => {
    softDeleteTransfer(id);
    refresh();
    setPendingDelete(null);
  };

  // Delete from inside an Edit modal: the same soft delete, then close the
  // modal (the record it was editing is no longer in the live list).
  const handleDeleteFromModal = (id: string) => {
    softDeleteTransfer(id);
    refresh();
    setModal({ kind: "none" });
  };

  const handleRestore = (id: string) => {
    restoreTransfer(id);
    refresh();
  };

  // The only irreversible action on this page. Gated by its own confirm.
  const handlePurge = (id: string) => {
    purgeTransfer(id);
    refresh();
    setPendingPurge(null);
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

  // Send money to a platform (Part 2): assigning a Platform is what puts a
  // transfer in the Transferred state, so this writes that one field and
  // nothing else — transferType, moneyStatus and any deploy-link stay put.
  const handleSendToPlatform = (target: Transfer, platform: string) => {
    const value = platform.trim().toUpperCase();
    if (value === "") return;
    saveTransfers(
      getTransfers().map((t) =>
        t.id === target.id ? { ...t, platform: value } : t,
      ),
    );
    refresh();
    setModal({ kind: "none" });
  };

  // Undo — clearing the platform returns the amount to Available Balance.
  const handleRemovePlatform = (target: Transfer) => {
    saveTransfers(
      getTransfers().map((t) =>
        t.id === target.id ? { ...t, platform: "" } : t,
      ),
    );
    refresh();
  };

  // Bulk send (Part 3): same shape as the bulk money-status marking — only
  // rows that are BOTH visible and still idle are touched, so an already
  // deployed/expensed/platformed row can never be silently re-routed.
  const applyBulkSendToPlatform = (platform: string) => {
    const value = platform.trim().toUpperCase();
    if (value === "") return;
    const targetIds = new Set(bulkPlatformTargets.map((t) => t.id));
    if (targetIds.size === 0) return;
    saveTransfers(
      getTransfers().map((t) =>
        targetIds.has(t.id) ? { ...t, platform: value } : t,
      ),
    );
    clearSelection();
    setBulkPlatform("");
    setPendingBulkPlatform(false);
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
    const withdrawalTotal = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    // A transfer marked "expense" is money that has left the business, so it
    // must leave Available Balance exactly like a logged withdrawal does. Until
    // now nothing read moneyStatus here, so marking a transfer as an Expense
    // changed a pill and nothing else — the balance still counted the money as
    // idle. Fixed 2026-07-30 (applies to every transfer type equally).
    const expensed = transfers.reduce(
      (sum, t) => (isExpensedTransfer(t) ? sum + t.amount : sum),
      0,
    );
    // Money linked to a position ("Mark as deployed") is no longer idle — it
    // now lives inside that position's Deposited (entered separately), so it is
    // excluded from Available. Undoing the link adds it straight back. The
    // expense guard keeps the two subtractions mutually exclusive, so a row
    // that is somehow both can never be deducted twice.
    const deployed = transfers.reduce(
      (sum, t) => (isDeployedTransfer(t) ? sum + t.amount : sum),
      0,
    );
    // Money sent to a platform for yield (AAVE …) is no longer idle either: it
    // is working somewhere else. Excluded from Available from this release on
    // — a deliberate, user-confirmed change (Redeployed money WITH a platform
    // used to stay counted as available). isTransferredToPlatform re-tests the
    // expense and deploy states, so the three subtractions below can never
    // overlap: a transfer that is deployed AND platformed counts once, as
    // Deployed; one later marked Expense counts once, as an Expense.
    const transferredToPlatform = transfers.reduce(
      (sum, t) => (isTransferredToPlatform(t) ? sum + t.amount : sum),
      0,
    );
    const withdrawn = withdrawalTotal + expensed;
    return {
      lifetimeEarned,
      withdrawalTotal,
      expensed,
      withdrawn,
      deployed,
      transferredToPlatform,
      available:
        lifetimeEarned - withdrawn - deployed - transferredToPlatform,
    };
  }, [transfers, withdrawals]);

  // "Expenses & Withdrawals" is the ledger of money out of the business, so it
  // lists BOTH logged withdrawals and any transfer marked as an Expense — the
  // two things the Expenses / Withdrawn card now adds together. Transfer-backed
  // rows are shown for visibility and edited/deleted from the transfer list
  // above (single source of truth for a transfer), so they carry no Delete here.
  const expenseLedger = useMemo(() => {
    const rows: {
      key: string;
      date: string;
      amount: number;
      method: string;
      notes: string;
      withdrawal?: Withdrawal;
      transfer?: Transfer;
    }[] = withdrawals.map((w) => ({
      key: `w-${w.id}`,
      date: w.date,
      amount: w.amount,
      method: w.method || "—",
      notes: w.notes,
      withdrawal: w,
    }));
    for (const t of transfers) {
      if (t.moneyStatus !== "expense") continue;
      rows.push({
        key: `t-${t.id}`,
        date: t.date,
        amount: t.amount,
        method:
          t.transferType === "expense"
            ? "Expense"
            : positionPairById.get(t.positionId) ?? "Transfer",
        notes: t.notes,
        transfer: t,
      });
    }
    return rows.sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [withdrawals, transfers, positionPairById]);

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

          <RecentlyDeletedSection
            rows={deletedTransfers}
            open={showDeleted}
            onToggle={() => {
              setShowDeleted((v) => !v);
              setPendingPurge(null);
            }}
            pairLabelFor={(t) =>
              t.transferType === "expense"
                ? "Expense"
                : positionPairById.get(t.positionId) ?? "—"
            }
            deployedLabelFor={(t) => deployedLabelOf(t) ?? "—"}
            pendingPurge={pendingPurge}
            onPurgeRequest={setPendingPurge}
            onPurgeConfirm={handlePurge}
            onPurgeCancel={() => setPendingPurge(null)}
            onRestore={handleRestore}
          />

          {/* Money Flow ledger: earned − withdrawn − deployed − transferred
              = available now. The three subtracted buckets are mutually
              exclusive (see the state predicates at the top of this file). */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryStat
              label="Lifetime Earned (USD)"
              value={formatUsd(balance.lifetimeEarned)}
              hint="Everything ever moved to a destination — never decreases."
            />
            <SummaryStat
              label="Expenses / Withdrawn (USD)"
              value={formatUsd(balance.withdrawn)}
              hint="Money out of the business: logged expenses/withdrawals plus any transfer marked as an Expense. Reduces Available Balance."
            />
            <SummaryStat
              label="Deployed into Positions (USD)"
              value={formatUsd(balance.deployed)}
              hint="Redeployed money you've linked to a position — now inside its Deposited, no longer idle."
            />
            <SummaryStat
              label="Transferred to Platforms (USD)"
              value={formatUsd(balance.transferredToPlatform)}
              hint="Money sent somewhere for yield (a transfer with a Platform assigned, e.g. AAVE) — working elsewhere, so no longer idle."
            />
            <SummaryStat
              label="Available Balance (USD)"
              value={formatUsd(balance.available)}
              hint="Lifetime Earned − Expenses/Withdrawn − Deployed − Transferred = what's still idle."
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

            <div className="grid grid-cols-1 gap-3 border-b border-[var(--border)] px-5 py-3 sm:grid-cols-2">
              {/* Narrowing to one position is what unlocks "Mark all N shown"
                  below — the same searchable picker Fee Claims uses. */}
              <PositionCombobox
                positions={positions}
                value={positionFilter}
                onChange={(next) => {
                  setPositionFilter(next);
                  clearSelection();
                }}
                allValue=""
                noteFor={positionNote}
              />
              <div>
                <label className="block text-xs font-medium text-[var(--muted)]">
                  Search
                </label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by pair, notes, type, destination…"
                  className="mt-1 block h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>
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
                  <datalist id="known-platforms">
                    {knownPlatforms.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Select all visible ({visibleIds.length})
                  </label>
                  {/* Position-scoped bulk action (Part 4): once the list is
                      narrowed to one position, mark every shown transfer in one
                      go — no per-row selection needed. Still applies only to
                      rows the user can actually see. */}
                  {positionFilter !== "" && selectedIds.size === 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {pendingBulk?.scope === "visible" ? (
                        <>
                          <span className="text-[12px] text-[var(--foreground)]">
                            {pendingBulk.status === "expense"
                              ? `Mark all ${visibleIds.length} shown as Expense?`
                              : `Undo Expense on all ${visibleIds.length} shown?`}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              applyBulkMark(pendingBulk.status, "visible")
                            }
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
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingBulk({
                                status: "redeployed",
                                scope: "visible",
                              })
                            }
                            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] font-medium text-[var(--foreground)] hover:border-[var(--accent)]"
                          >
                            Undo Expense on all {visibleIds.length} shown
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingBulk({
                                status: "expense",
                                scope: "visible",
                              })
                            }
                            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[12px] font-medium text-rose-300 hover:bg-rose-500/20"
                          >
                            Mark all {visibleIds.length} shown as Expense
                          </button>
                        </>
                      )}
                      {/* Bulk Send to Platform (Part 3): type a platform once
                          and route every still-idle row in this filtered view
                          to it. Confirmed, like every other bulk action. */}
                      {bulkPlatformTargets.length > 0 &&
                        (pendingBulkPlatform ? (
                          <>
                            <span className="text-[12px] text-[var(--foreground)]">
                              Send {bulkPlatformTargets.length} idle shown to{" "}
                              {bulkPlatform.trim().toUpperCase()}?
                            </span>
                            <button
                              type="button"
                              onClick={() => applyBulkSendToPlatform(bulkPlatform)}
                              className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[var(--accent)]/90"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingBulkPlatform(false)}
                              className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] font-medium text-[var(--muted)] hover:bg-[var(--surface-2)]"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <input
                              value={bulkPlatform}
                              onChange={(e) => setBulkPlatform(e.target.value)}
                              list="known-platforms"
                              placeholder="Platform (e.g. AAVE)"
                              className="h-7 w-40 rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-[12px] uppercase text-[var(--foreground)] placeholder:normal-case placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={bulkPlatform.trim() === ""}
                              onClick={() => setPendingBulkPlatform(true)}
                              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[12px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Send all {bulkPlatformTargets.length} idle shown to
                              platform
                            </button>
                          </>
                        ))}
                    </div>
                  )}
                  {selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--foreground)]">
                        {selectedIds.size} selected
                      </span>
                      {pendingBulk?.scope === "selected" ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-[var(--foreground)]">
                            {pendingBulk.status === "expense"
                              ? `Mark ${
                                  visibleIds.filter((id) => selectedIds.has(id))
                                    .length
                                } as Expense?`
                              : `Undo Expense on ${
                                  visibleIds.filter((id) => selectedIds.has(id))
                                    .length
                                }?`}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              applyBulkMark(pendingBulk.status, "selected")
                            }
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
                            onClick={() =>
                              setPendingBulk({
                                status: "redeployed",
                                scope: "selected",
                              })
                            }
                            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] font-medium text-[var(--foreground)] hover:border-[var(--accent)]"
                          >
                            Undo Expense
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingBulk({
                                status: "expense",
                                scope: "selected",
                              })
                            }
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
                            datesLabel={upsideDatesLabel(t)}
                            transfer={t}
                            pairLabel={
                              t.transferType === "expense"
                                ? "Expense"
                                : positionPairById.get(t.positionId) ?? "—"
                            }
                            deployedLabel={deployedLabelOf(t)}
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
                            onSendToPlatform={(tr) =>
                              setModal({ kind: "platform", transfer: tr })
                            }
                            onRemovePlatform={handleRemovePlatform}
                            onRevertToAuto={(tr) =>
                              setModal({ kind: "revert", transfer: tr })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {expenseLedger.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-tight">
                  Expenses &amp; Withdrawals
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Money out of the business — logged expenses, personal
                  withdrawals, and any transfer marked as an Expense. Each
                  reduces Available Balance.
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
                    {expenseLedger.map((row) => {
                      const w = row.withdrawal;
                      return (
                      <tr
                        key={row.key}
                        className="transition-colors hover:bg-[var(--surface-2)]/60"
                      >
                        <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                          {formatDateDDMMYYYY(row.date)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatUsd(row.amount)}
                        </td>
                        <td className="px-4 py-3 text-[var(--foreground)]">
                          {row.method}
                          {row.transfer && (
                            <span className="ml-2 inline-flex items-center rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                              From transfer
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-[var(--muted)]">
                          {row.notes || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {/* Transfer-backed rows are edited in the transfer
                              list above — one source of truth per record. */}
                          {!w ? (
                            <button
                              type="button"
                              onClick={() =>
                                row.transfer &&
                                setModal(
                                  row.transfer.transferType === "expense"
                                    ? {
                                        kind: "editExpense",
                                        transfer: row.transfer,
                                      }
                                    : { kind: "edit", transfer: row.transfer },
                                )
                              }
                              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                            >
                              Edit
                            </button>
                          ) : pendingWithdrawalDelete === w.id ? (
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
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
                    <tr className="font-semibold">
                      <td className="px-4 py-3">Total Out of Business</td>
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
              onDelete={() => handleDeleteFromModal(modal.transfer.id)}
            />
          )}
          {modal.kind === "editExpense" && (
            <ExpenseFormModal
              title="Edit Expense"
              submitLabel="Save Changes"
              initial={expenseToForm(modal.transfer)}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(form) => handleEditExpense(modal.transfer, form)}
              onDelete={() => handleDeleteFromModal(modal.transfer.id)}
            />
          )}
          {modal.kind === "revert" && (
            <RevertToAutoModal
              transfer={modal.transfer}
              claims={claims}
              positions={positions}
              onCancel={() => setModal({ kind: "none" })}
              onApplied={() => {
                refresh();
                setModal({ kind: "none" });
              }}
            />
          )}
          {modal.kind === "deploy" && (
            <DeployLinkModal
              transfer={modal.transfer}
              positions={positions}
              noteFor={positionNote}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(positionId) =>
                handleMarkDeployed(modal.transfer, positionId)
              }
            />
          )}
          {modal.kind === "platform" && (
            <SendToPlatformModal
              transfer={modal.transfer}
              knownPlatforms={knownPlatforms}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(platform) =>
                handleSendToPlatform(modal.transfer, platform)
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
  // Present only when editing an existing record. Calls the SAME soft-delete
  // handler the row-level Delete uses, so the record lands in Recently Deleted
  // and stays restorable — there is deliberately no second delete path.
  onDelete?: () => void;
}

function FormActions({ onCancel, submitLabel, onDelete }: FormActionsProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">
      {onDelete &&
        (confirming ? (
          <div className="mr-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--muted)]">
              Delete this? You can restore it from Recently Deleted.
            </span>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mr-auto inline-flex h-9 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-medium text-rose-300 hover:bg-rose-500/20"
          >
            Delete
          </button>
        ))}
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
  onDelete?: () => void;
}

function TransferFormModal({
  title,
  submitLabel,
  initial,
  positions,
  onCancel,
  onSubmit,
  onDelete,
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
            {/* Platform is OPTIONAL. It used to be `required`, which blocked
                saving any unrelated edit (a typo in the notes, a money-status
                change) on the auto-created transfers that deliberately start
                with a blank platform. Assigning one is still what moves money
                into the Transferred state — that is driven by the field's
                value, never by the form validating it. */}
            <Field
              label="Platform (from)"
              htmlFor="platform"
              hint="Where the money came from — optional. Filling this in marks the money as Transferred to that platform."
            >
              <input
                id="platform"
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
                hint="Redeployed is the normal state every transfer starts in — money still working in the business. Switch to Expense only when the money has genuinely left the business; setting it back to Redeployed is how you undo that."
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
        <FormActions
          onCancel={onCancel}
          submitLabel={submitLabel}
          onDelete={onDelete}
        />
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
// Picks the position a Redeployed transfer's money went into. All positions are
// offered — usually a new active one, but a top-up into any existing position is
// valid, so we don't over-restrict; active are listed first, closed labelled.
// "Not sure which position" is offered too, so money the user knows was deployed
// is not left sitting in Available Balance just because they can't place it.
// Confirming records the link; the position itself is never modified.
function DeployLinkModal({
  transfer,
  positions,
  noteFor,
  onCancel,
  onSubmit,
}: {
  transfer: Transfer;
  positions: Position[];
  // Per-position memory aid ("already has $X deployed", "fully expensed"),
  // shared with the page's position filter so the two can never word it
  // differently. Informational only — it never blocks picking a position,
  // since topping one up is legitimate.
  noteFor: (p: Position) => { text: string; tone: "muted" | "danger" } | null;
  onCancel: () => void;
  onSubmit: (positionId: string) => void;
}) {
  const [positionId, setPositionId] = useState(
    transfer.deployedToPositionId ?? "",
  );
  // Memory aid, not a guess: money usually goes into a position opened just
  // AFTER it came in, so positions opened soonest after this transfer's date
  // come first, then everything else by how far away it is in either
  // direction. The existing active-before-closed grouping is kept as the
  // primary key — it is a deliberate convention (a top-up into a closed
  // position is legal but rare), so proximity only reorders WITHIN each group.
  const transferTime = new Date(transfer.date).getTime();
  const proximityRank = (p: Position): number => {
    const opened = new Date(p.entryDatetime).getTime();
    if (!Number.isFinite(opened) || !Number.isFinite(transferTime)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const delta = opened - transferTime;
    // Opened after the transfer sorts ahead of the same gap before it; the
    // small penalty is what breaks the tie without hiding earlier positions.
    return delta >= 0 ? delta : -delta * 1.5;
  };
  // Applied inside each chain's Open/Closed section by the shared combobox,
  // which owns the chain grouping and the open-before-closed split.
  const byProximity = (a: Position, b: Position) => {
    const rank = proximityRank(a) - proximityRank(b);
    return rank !== 0 ? rank : a.pair.localeCompare(b.pair);
  };
  return (
    <ModalShell title="Mark as deployed" onCancel={onCancel}>
      <Section title="Deploy into a position">
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted)]">
          {/* Explicit {" "} — the literal space after the expression is
              trimmed at build time, rendering "$500.00transfer". */}
          Link this {formatUsd(transfer.amount)}{" "}
          transfer to the position its money went into. It stays in the list but leaves Available Balance
          until you undo. The position&apos;s own Deposited figure is unchanged
          — you entered that separately when you opened it. If you can&apos;t
          remember which position, say so — the money still counts as deployed
          and you can name it later.
        </p>
        {/* The shared searchable picker rather than a native <select>: macOS
            draws select popups itself and ignores option colour, so the red
            "fully expensed" warning could only be a ⚠ glyph there. Here the
            colour is real. Search, chain grouping and the Open/Closed split all
            come with it, matching the pickers everywhere else. "Not sure which
            position" rides in on the existing all-entry slot, so it stays
            selectable above the real positions. */}
        <PositionCombobox
          positions={positions}
          value={positionId}
          onChange={setPositionId}
          label="Position"
          allValue={UNKNOWN_POSITION_ID}
          allLabel="Not sure which position (deployed, unknown)"
          noteFor={noteFor}
          sortWithinSection={byProximity}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          Within each chain, positions opened closest to this transfer&apos;s
          date ({formatDateDDMMYYYY(transfer.date)}) come first — a memory aid,
          not a guess. You can change this later.
        </p>
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

// Names the platform a single transfer's money was sent to (Part 2). Free
// text with autocomplete over platforms already in use, since platforms are
// user-defined strings everywhere else in the app; stored uppercase like every
// other platform value. Assigning it is what moves the money into the
// Transferred state, so the balance consequence is spelled out here.
function SendToPlatformModal({
  transfer,
  knownPlatforms,
  onCancel,
  onSubmit,
}: {
  transfer: Transfer;
  knownPlatforms: string[];
  onCancel: () => void;
  onSubmit: (platform: string) => void;
}) {
  const [platform, setPlatform] = useState(transfer.platform ?? "");
  return (
    <ModalShell title="Send to Platform" onCancel={onCancel}>
      <Section title="Where did this money go?">
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted)]">
          Name the platform this {formatUsd(transfer.amount)} was sent to for
          yield (AAVE, a CEX, anywhere it is working). It stays in the list but
          leaves Available Balance and joins Transferred to Platforms — clear
          the platform again to bring it back.
        </p>
        <Field label="Platform" htmlFor="send-platform">
          <input
            id="send-platform"
            list="send-platform-options"
            value={platform}
            onChange={(e) => setPlatform(e.target.value.toUpperCase())}
            placeholder="AAVE"
            className={inputClass}
          />
          <datalist id="send-platform-options">
            {knownPlatforms.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
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
          disabled={platform.trim() === ""}
          onClick={() => onSubmit(platform)}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm
        </button>
      </div>
    </ModalShell>
  );
}

// Shows what "Revert to auto-created" would produce BEFORE anything is written:
// the plan is computed on open (the dual-token case fetches historical prices,
// hence the loading state), rendered as a current → new comparison, and only
// applied on an explicit Confirm. A dual-token claim owns two transfers whose
// amounts are computed against each other, so the whole source group is shown
// and rebuilt together — reverting one leg in isolation could not reproduce the
// split.
function RevertToAutoModal({
  transfer,
  claims,
  positions,
  onCancel,
  onApplied,
}: {
  transfer: Transfer;
  claims: FeeClaim[];
  positions: Position[];
  onCancel: () => void;
  onApplied: () => void;
}) {
  const [plan, setPlan] = useState<AutoRevertPlan | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    planRevertToAuto(transfer, claims, positions)
      .then((p) => {
        if (live) setPlan(p);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [transfer, claims, positions]);

  const describe = (t: Transfer) =>
    `${t.token || "—"} · ${formatUsd(t.amount)} · platform ${
      t.platform || "(none)"
    } · ${t.moneyStatus ?? "idle"}`;

  return (
    <ModalShell title="Revert to auto-created" onCancel={onCancel}>
      <Section
        title={
          plan?.source === "close"
            ? "Recomputed from the linked close"
            : "Recomputed from the linked fee claim"
        }
      >
        {failed || (plan && plan.error) ? (
          <p className="text-[12px] leading-relaxed text-amber-300">
            {plan?.error ??
              "Could not recompute this transfer right now. Nothing has been changed."}
          </p>
        ) : !plan ? (
          <p className="text-[12px] text-[var(--muted)]">
            Recomputing from the linked record…
          </p>
        ) : (
          <>
            <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted)]">
              This will discard your changes to{" "}
              {plan.current.length === 1
                ? "this transfer"
                : `these ${plan.current.length} transfers`}{" "}
              and rebuild{" "}
              {plan.next.length === 1 ? "it" : "them"} from the linked record as
              it stands now. Platform, destination, money status, any deploy
              link and the notes all go back to what the automation writes.
            </p>
            <div className="space-y-3">
              {plan.next.map((next, i) => {
                const before = plan.current[i];
                return (
                  <div
                    key={next.id}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-2)]/30 px-3 py-2.5"
                  >
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      Now
                    </p>
                    <p className="text-[12px] text-[var(--muted)] line-through">
                      {before ? describe(before) : "— (new record)"}
                    </p>
                    <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                      After revert
                    </p>
                    <p className="text-[13px] font-medium text-[var(--foreground)]">
                      {describe(next)}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      dated {formatDateDDMMYYYY(next.date)}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
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
          disabled={!plan || plan.next.length === 0}
          onClick={() => {
            if (!plan) return;
            applyRevertToAuto(plan);
            onApplied();
          }}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
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
  onDelete,
}: {
  title: string;
  submitLabel: string;
  initial: ExpenseFormState;
  onCancel: () => void;
  onSubmit: (form: ExpenseFormState) => void;
  onDelete?: () => void;
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
        <FormActions
          onCancel={onCancel}
          submitLabel={submitLabel}
          onDelete={onDelete}
        />
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
