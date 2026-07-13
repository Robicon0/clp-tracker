"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getClaims,
  getPoolPnL,
  getPositions,
  getRanges,
  savePoolPnL,
  savePositions,
  saveRanges,
} from "../../lib/storage";
import {
  calcDaysActive,
  calcFeeAPR,
  calcPositionProfit,
  calcPriceDiff,
  calcTotalFees,
  calcWideRangePercent,
  computePositionIL,
  getEffectiveClaimed,
  getEffectiveDeposited,
  getEffectiveTotalFees,
  type ILResult,
} from "../../lib/calculations";
import {
  ClaimFormModal,
  persistNewClaim,
} from "../../components/ClaimFormModal";
import type { FeeClaim } from "../../lib/types";
import type {
  LPRange,
  PoolPnLEntry,
  Position,
} from "../../lib/types";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(value: number): string {
  return usdFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(2)}%`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateTime24(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowDatetimeLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function pnlColor(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-[var(--foreground)]";
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNum(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeeTier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("%") ? trimmed : `${trimmed}%`;
}

function computeShortTotal(
  gain: number | null,
  loss: number | null,
  funding: number | null,
): number | null {
  if (gain === null && loss === null && funding === null) return null;
  return (gain ?? 0) - (loss ?? 0) + (funding ?? 0);
}

// Deposited USD is derived, never typed (Invariant #9):
// (base token count × entry price) + quote token count. Falls back to the
// carried stored value only for legacy records with missing token counts —
// mirrors getEffectiveDeposited in lib/calculations.
function formDeposited(form: PositionFormState): number {
  const base = num(form.token1Count);
  const entry = num(form.entryPrice);
  const quote = num(form.token2Count);
  const computed =
    (base > 0 && entry > 0 ? base * entry : 0) + (quote > 0 ? quote : 0);
  return computed > 0 ? computed : num(form.deposited);
}

// Parses form strings, then delegates to the shared computePositionIL in
// lib/calculations (Invariant #6 — one IL source of truth across pages).
// Form naming: token1 = base token (calcIL token0), token2 = quote token
// (calcIL token1, priced at $1 by convention).
function tryComputeIL(
  form: PositionFormState,
  side: "down" | "up",
): ILResult | null {
  if (
    [form.entryPrice, form.bottomRange, form.topRange].some(
      (v) => v.trim() === "",
    )
  ) {
    return null;
  }
  const rangeDown = Number(form.bottomRange);
  const rangeUp = Number(form.topRange);
  return computePositionIL(
    {
      entryPrice: Number(form.entryPrice),
      rangeDown,
      rangeUp,
      deposited: formDeposited(form),
      token0Count: num(form.token1Count),
      token1Count: num(form.token2Count),
    },
    side === "down" ? rangeDown : rangeUp,
  );
}

interface DerivedRow {
  position: Position;
  deposited: number;
  claimed: number;
  fees: number;
  days: number;
  apr: number;
  priceDiff: number;
  profit: number;
}

function derive(positions: Position[], allClaims: FeeClaim[]): DerivedRow[] {
  return positions.map((position) => {
    const deposited = getEffectiveDeposited(position);
    const claimed = getEffectiveClaimed(position, allClaims);
    const fees = getEffectiveTotalFees(position, allClaims);
    const days = calcDaysActive(position.entryDatetime, position.exitDatetime);
    const apr = calcFeeAPR(fees, deposited, days);
    const priceDiff = calcPriceDiff(position.currentBalance, deposited);
    const profit = calcPositionProfit(position, fees, priceDiff);
    return { position, deposited, claimed, fees, days, apr, priceDiff, profit };
  });
}

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; position: Position }
  | { kind: "update"; position: Position }
  | { kind: "close"; position: Position }
  | { kind: "claim"; position: Position };

interface PositionFormState {
  pair: string;
  feeTier: string;
  chain: string;
  protocol: string;
  entryDatetime: string;
  deposited: string;
  scalp: string;
  notes: string;
  entryPrice: string;
  bottomRange: string;
  topRange: string;
  token1Symbol: string;
  token2Symbol: string;
  token1Count: string;
  token2Count: string;
  txLink: string;
  shortDateStart: string;
  shortDateEnd: string;
  shortTokenAmount: string;
  shortUsdAmount: string;
  shortGain: string;
  shortLoss: string;
  shortFundingFees: string;
  shortNotes: string;
}

const EMPTY_FORM: PositionFormState = {
  pair: "",
  feeTier: "",
  chain: "",
  protocol: "",
  entryDatetime: "",
  deposited: "",
  scalp: "",
  notes: "",
  entryPrice: "",
  bottomRange: "",
  topRange: "",
  token1Symbol: "",
  token2Symbol: "",
  token1Count: "",
  token2Count: "",
  txLink: "",
  shortDateStart: "",
  shortDateEnd: "",
  shortTokenAmount: "",
  shortUsdAmount: "",
  shortGain: "",
  shortLoss: "",
  shortFundingFees: "",
  shortNotes: "",
};

function positionToForm(p: Position): PositionFormState {
  const m = p.pair.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const pair = m ? m[1] : p.pair;
  const feeTier = m ? m[2] : "";
  const numStr = (n: number | null): string =>
    n === null || !Number.isFinite(n) ? "" : String(n);
  return {
    pair,
    feeTier,
    chain: p.chain,
    protocol: p.protocol,
    entryDatetime: isoToDatetimeLocal(p.entryDatetime),
    deposited: String(p.deposited),
    scalp: numStr(p.scalp),
    notes: p.notes,
    entryPrice: String(p.entryPrice),
    bottomRange: String(p.bottomRange),
    topRange: String(p.topRange),
    token1Symbol: p.token1Symbol,
    token2Symbol: p.token2Symbol,
    token1Count: String(p.token1Count),
    token2Count: String(p.token2Count),
    txLink: p.txLink ?? "",
    shortDateStart: isoToDateInput(p.shortDateStart),
    shortDateEnd: isoToDateInput(p.shortDateEnd),
    shortTokenAmount: numStr(p.shortTokenAmount),
    shortUsdAmount: numStr(p.shortUsdAmount),
    shortGain: numStr(p.shortGain),
    shortLoss: numStr(p.shortLoss),
    shortFundingFees: numStr(p.shortFundingFees),
    shortNotes: p.shortNotes ?? "",
  };
}

interface BuiltRecords {
  position: Position;
  range: LPRange;
  pool: PoolPnLEntry;
}

function buildRecords(
  id: string,
  form: PositionFormState,
  base: Position | null,
): BuiltRecords {
  const trimmedPair = form.pair.trim().toUpperCase();
  const trimmedFeeTier = normalizeFeeTier(form.feeTier);
  const combinedPair = trimmedFeeTier
    ? `${trimmedPair} (${trimmedFeeTier})`
    : trimmedPair;

  const entryIso = form.entryDatetime
    ? new Date(form.entryDatetime).toISOString()
    : new Date().toISOString();

  // Stored deposited is a cache of the derived value — rewritten on every
  // Add/Edit save so storage stays in sync with the computed truth.
  const deposited = formDeposited(form);
  const sGain = optionalNum(form.shortGain);
  const sLoss = optionalNum(form.shortLoss);
  const sFunding = optionalNum(form.shortFundingFees);
  const sTotal = computeShortTotal(sGain, sLoss, sFunding);
  // Stored outOfRangeUpside/Downside are last-computed values and may be
  // stale — readers must always prefer live recomputation via
  // computePositionIL and only fall back to these on corrupt/incomplete
  // records.
  const upIL = tryComputeIL(form, "up");
  const downIL = tryComputeIL(form, "down");
  const ooUp = upIL ? upIL.lpValue : null;
  const ooDown = downIL ? downIL.lpValue : null;

  const position: Position = {
    id,
    pair: combinedPair,
    chain: form.chain.trim().toUpperCase(),
    protocol: form.protocol.trim().toUpperCase(),
    entryDatetime: entryIso,
    exitDatetime: base?.exitDatetime ?? null,
    deposited,
    currentBalance: base?.currentBalance ?? deposited,
    newFees: base?.newFees ?? 0,
    claimed: base?.claimed ?? 0,
    totalFees:
      base !== null
        ? calcTotalFees(base.claimed, base.newFees)
        : 0,
    bottomRange: num(form.bottomRange),
    topRange: num(form.topRange),
    token1Symbol: form.token1Symbol.trim().toUpperCase(),
    token2Symbol: form.token2Symbol.trim().toUpperCase(),
    token1Count: num(form.token1Count),
    token2Count: num(form.token2Count),
    entryPrice: num(form.entryPrice),
    shortDateStart: dateInputToIso(form.shortDateStart),
    shortDateEnd: dateInputToIso(form.shortDateEnd),
    shortTokenAmount: optionalNum(form.shortTokenAmount),
    shortUsdAmount: optionalNum(form.shortUsdAmount),
    shortGain: sGain,
    shortLoss: sLoss,
    shortFundingFees: sFunding,
    shortTotal: sTotal,
    shortNotes: form.shortNotes.trim() ? form.shortNotes.trim().toUpperCase() : null,
    outOfRangeUpside: ooUp,
    outOfRangeDownside: ooDown,
    scalp: optionalNum(form.scalp),
    txLink: form.txLink.trim() === "" ? null : form.txLink.trim(),
    notes: form.notes.trim().toUpperCase(),
    status: base?.status ?? "active",
  };

  const range: LPRange = {
    id,
    positionId: id,
    pair: position.pair,
    entryPrice: position.entryPrice,
    bottomRange: position.bottomRange,
    topRange: position.topRange,
    token1Symbol: position.token1Symbol,
    token2Symbol: position.token2Symbol,
    token1Count: position.token1Count,
    token2Count: position.token2Count,
    entryDatetime: position.entryDatetime,
  };

  const pool: PoolPnLEntry = {
    id,
    positionId: id,
    pair: position.pair,
    chain: position.chain,
    protocol: position.protocol,
    shortDateStart: position.shortDateStart,
    shortDateEnd: position.shortDateEnd,
    shortTokenAmount: position.shortTokenAmount,
    shortUsdAmount: position.shortUsdAmount,
    shortGain: position.shortGain,
    shortLoss: position.shortLoss,
    shortFundingFees: position.shortFundingFees,
    shortTotal: position.shortTotal,
    shortNotes: position.shortNotes,
    outOfRangeUpside: position.outOfRangeUpside,
    outOfRangeDownside: position.outOfRangeDownside,
    entryDatetime: position.entryDatetime,
  };

  return { position, range, pool };
}

export default function PositionsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [showClosed, setShowClosed] = useState(false);

  const refresh = () => {
    setPositions(getPositions());
    setClaims(getClaims());
  };

  useEffect(() => {
    refresh();
    setHydrated(true);
  }, []);

  const active = hydrated
    ? derive(positions.filter((p) => p.status === "active"), claims)
    : [];
  const closed = hydrated
    ? derive(positions.filter((p) => p.status === "closed"), claims)
    : [];

  const persistFull = (records: BuiltRecords, mode: "add" | "edit") => {
    if (mode === "add") {
      savePositions([...getPositions(), records.position]);
      saveRanges([...getRanges(), records.range]);
      savePoolPnL([...getPoolPnL(), records.pool]);
    } else {
      savePositions(
        getPositions().map((p) =>
          p.id === records.position.id ? records.position : p,
        ),
      );
      const ranges = getRanges();
      const hasRange = ranges.some((r) => r.positionId === records.range.positionId);
      saveRanges(
        hasRange
          ? ranges.map((r) =>
              r.positionId === records.range.positionId ? records.range : r,
            )
          : [...ranges, records.range],
      );
      const pools = getPoolPnL();
      const hasPool = pools.some((p) => p.positionId === records.pool.positionId);
      savePoolPnL(
        hasPool
          ? pools.map((p) =>
              p.positionId === records.pool.positionId ? records.pool : p,
            )
          : [...pools, records.pool],
      );
    }
    refresh();
    setModal({ kind: "none" });
  };

  const handleAdd = (form: PositionFormState) => {
    persistFull(buildRecords(newId(), form, null), "add");
  };

  const handleEdit = (target: Position, form: PositionFormState) => {
    persistFull(buildRecords(target.id, form, target), "edit");
  };

  // Claimed is no longer part of the payload — it is derived from claim
  // records (Invariant #10); the stored value stays as legacy fallback.
  const handleUpdate = (
    target: Position,
    next: { currentBalance: number; newFees: number },
  ) => {
    const updated = getPositions().map((p) =>
      p.id === target.id
        ? {
            ...p,
            currentBalance: next.currentBalance,
            newFees: next.newFees,
            totalFees: calcTotalFees(p.claimed, next.newFees),
          }
        : p,
    );
    savePositions(updated);
    refresh();
    setModal({ kind: "none" });
  };

  // Shared claim save path (persistNewClaim) — identical to the Fee Claims
  // page so both entry points update position totals the same way.
  const handleClaimSubmit = (claim: FeeClaim) => {
    persistNewClaim(claim);
    refresh();
    setModal({ kind: "none" });
  };

  const handleClose = (
    target: Position,
    next: {
      exitDatetime: string;
      currentBalance: number;
      scalp: number | null;
      feeClaim?: {
        token1Amount: number;
        token2Amount: number;
        stableAmount: number | null;
        convertedToStable: boolean;
        stableSymbol: string | null;
        txId: string | null;
      };
    },
  ) => {
    // Claim is created BEFORE the position is closed: if anything throws
    // between the two writes, the position stays open with a logged claim
    // (harmless, retryable) rather than closed with silently lost fees.
    if (next.feeClaim) {
      persistNewClaim({
        id: newId(),
        positionId: target.id,
        date: next.exitDatetime,
        pair: target.pair,
        platform: target.protocol,
        chain: target.chain,
        token1Symbol: target.token1Symbol,
        token1Amount: next.feeClaim.token1Amount,
        token2Symbol: target.token2Symbol,
        token2Amount: next.feeClaim.token2Amount,
        convertedToStable: next.feeClaim.convertedToStable,
        stableSymbol: next.feeClaim.stableSymbol,
        stableAmount: next.feeClaim.stableAmount,
        currentPositionValue: null,
        txId: next.feeClaim.txId,
        notes: "",
      });
    }

    const updated = getPositions().map((p) =>
      p.id === target.id
        ? {
            ...p,
            exitDatetime: next.exitDatetime,
            currentBalance: next.currentBalance,
            scalp: next.scalp,
            status: "closed" as const,
          }
        : p,
    );
    savePositions(updated);
    refresh();
    setModal({ kind: "none" });
  };

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Open new positions, track active ones, and close finished ones.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: "add" })}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
        >
          Add Position
        </button>
      </header>

      <PositionsTable
        title="Active Positions"
        rows={active}
        variant="active"
        onEdit={(p) => setModal({ kind: "edit", position: p })}
        onUpdate={(p) => setModal({ kind: "update", position: p })}
        onClose={(p) => setModal({ kind: "close", position: p })}
        onClaim={(p) => setModal({ kind: "claim", position: p })}
        emptyText="No active positions. Click Add Position to get started."
      />

      <ClosedSection
        rows={closed}
        open={showClosed}
        onToggle={() => setShowClosed((v) => !v)}
        onClaim={(p) => setModal({ kind: "claim", position: p })}
      />

      {modal.kind === "add" && (
        <PositionFormModal
          title="Add Position"
          submitLabel="Add Position"
          initial={{ ...EMPTY_FORM, entryDatetime: nowDatetimeLocal() }}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={handleAdd}
        />
      )}
      {modal.kind === "edit" && (
        <PositionFormModal
          title={`Edit — ${modal.position.pair}`}
          submitLabel="Save Changes"
          initial={positionToForm(modal.position)}
          editingStatus={modal.position.status}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={(form) => handleEdit(modal.position, form)}
        />
      )}
      {modal.kind === "update" && (
        <UpdatePositionModal
          position={modal.position}
          derivedClaimed={getEffectiveClaimed(modal.position, claims)}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={(next) => handleUpdate(modal.position, next)}
        />
      )}
      {modal.kind === "claim" && (
        <ClaimFormModal
          mode="add"
          positions={positions}
          lockedPositionId={modal.position.id}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={handleClaimSubmit}
        />
      )}
      {modal.kind === "close" && (
        <ClosePositionModal
          position={modal.position}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={(next) => handleClose(modal.position, next)}
        />
      )}
    </section>
  );
}

interface TxLinkBadgeProps {
  value: string | null;
}

function TxLinkBadge({ value }: TxLinkBadgeProps) {
  if (!value) return null;
  const isUrl = /^https?:\/\//i.test(value);
  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        title="Open transaction"
        aria-label="Open transaction"
        className="text-[var(--accent)] hover:opacity-80"
        onClick={(e) => e.stopPropagation()}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path
            d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    );
  }
  const hint = value.length > 8 ? `${value.slice(0, 8)}…` : value;
  return (
    <span
      title={value}
      className="font-mono text-[10px] text-[var(--muted)]"
      aria-label={`Transaction ${hint}`}
    >
      {hint}
    </span>
  );
}

interface PositionsTableProps {
  title: string;
  rows: DerivedRow[];
  variant: "active" | "closed";
  onEdit?: (p: Position) => void;
  onUpdate?: (p: Position) => void;
  onClose?: (p: Position) => void;
  onClaim?: (p: Position) => void;
  emptyText: string;
}

function PositionsTable({
  title,
  rows,
  variant,
  onEdit,
  onUpdate,
  onClose,
  onClaim,
  emptyText,
}: PositionsTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {title && (
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <span className="text-xs text-[var(--muted)]">
            {rows.length} {rows.length === 1 ? "position" : "positions"}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Pair</th>
                <th className="px-4 py-3 text-left font-medium">Chain</th>
                <th className="px-4 py-3 text-left font-medium">Protocol</th>
                <th className="px-4 py-3 text-right font-medium">Deposited</th>
                <th className="px-4 py-3 text-right font-medium">
                  Current Balance
                </th>
                <th className="px-4 py-3 text-right font-medium">New Fees</th>
                <th className="px-4 py-3 text-right font-medium">Claimed</th>
                <th className="px-4 py-3 text-right font-medium">Total Fees</th>
                <th className="px-4 py-3 text-right font-medium">Fee APR</th>
                <th className="px-4 py-3 text-right font-medium">Range %</th>
                {variant === "active" ? (
                  <th className="px-4 py-3 text-right font-medium">
                    Days Active
                  </th>
                ) : (
                  <th className="px-4 py-3 text-left font-medium">Exit Date</th>
                )}
                <th className="px-4 py-3 text-right font-medium">Price Diff</th>
                {variant === "closed" && (
                  <th className="px-4 py-3 text-right font-medium">Scalp</th>
                )}
                <th className="px-4 py-3 text-right font-medium">Profit</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map(({ position, deposited, claimed, fees, days, apr, priceDiff, profit }) => (
                <tr
                  key={position.id}
                  className="transition-colors hover:bg-[var(--surface-2)]/60"
                >
                  <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                    <span className="inline-flex items-center gap-1.5">
                      {position.pair}
                      <TxLinkBadge value={position.txLink ?? null} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {position.chain}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {position.protocol}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUsd(deposited)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUsd(position.currentBalance)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUsd(position.newFees)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUsd(claimed)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUsd(fees)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPercent(apr)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                    {(() => {
                      const wr = calcWideRangePercent(
                        position.bottomRange,
                        position.topRange,
                      );
                      return wr > 0 ? formatPercent(wr) : "—";
                    })()}
                  </td>
                  {variant === "active" ? (
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                      {days.toFixed(1)}
                    </td>
                  ) : (
                    <td className="px-4 py-3 text-[var(--muted)]">
                      <div className="tabular-nums">
                        {formatDateTime24(position.exitDatetime)}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]/80">
                        {days.toFixed(1)} days held
                      </div>
                    </td>
                  )}
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${pnlColor(priceDiff)}`}
                  >
                    {formatUsd(priceDiff)}
                  </td>
                  {variant === "closed" && (
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-medium ${pnlColor(position.scalp ?? 0)}`}
                    >
                      {formatUsd(position.scalp ?? 0)}
                    </td>
                  )}
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${pnlColor(profit)}`}
                  >
                    {formatUsd(profit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      {variant === "active" && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEdit?.(position)}
                            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdate?.(position)}
                            className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
                          >
                            Update
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onClaim?.(position)}
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Claim
                      </button>
                      {variant === "active" && (
                        <button
                          type="button"
                          onClick={() => onClose?.(position)}
                          className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ClosedSectionProps {
  rows: DerivedRow[];
  open: boolean;
  onToggle: () => void;
  onClaim?: (p: Position) => void;
}

function ClosedSection({ rows, open, onToggle, onClaim }: ClosedSectionProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-[var(--border)] px-5 py-4 text-left transition-colors hover:bg-[var(--surface-2)]/50"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold tracking-tight">
          {open ? "Hide" : "Show"} Closed Positions ({rows.length})
        </span>
        <span className="text-xs text-[var(--muted)]" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open &&
        (rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
            No closed positions yet.
          </div>
        ) : (
          <PositionsTable
            title=""
            rows={rows}
            variant="closed"
            onClaim={onClaim}
            emptyText=""
          />
        ))}
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

interface DateTimeFieldsProps {
  dateLabel: string;
  timeLabel: string;
  idPrefix: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}

function DateTimeFields({
  dateLabel,
  timeLabel,
  idPrefix,
  value,
  onChange,
  required,
}: DateTimeFieldsProps) {
  const [d = "", t = ""] = (value || "").split("T");
  const [hStr = "", mStr = ""] = (t || "").split(":");
  const dateId = `${idPrefix}-date`;
  const hourId = `${idPrefix}-hour`;
  const minId = `${idPrefix}-min`;

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const setDate = (newDate: string) => {
    onChange(`${newDate}T${hStr || "00"}:${mStr || "00"}`);
  };
  const setHour = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(-2);
    const n =
      digits === ""
        ? 0
        : Math.max(0, Math.min(23, Number.parseInt(digits, 10) || 0));
    onChange(`${d}T${pad2(n)}:${mStr || "00"}`);
  };
  const setMin = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(-2);
    const n =
      digits === ""
        ? 0
        : Math.max(0, Math.min(59, Number.parseInt(digits, 10) || 0));
    onChange(`${d}T${hStr || "00"}:${pad2(n)}`);
  };

  return (
    <>
      <Field label={dateLabel} htmlFor={dateId}>
        <div suppressHydrationWarning>
          <input
            id={dateId}
            type="date"
            required={required}
            className={inputClass}
            style={{ colorScheme: "dark" }}
            value={d}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </Field>
      <Field
        label={timeLabel}
        htmlFor={hourId}
        hint="24hr format — e.g. 13:44"
      >
        <div className="flex items-center gap-2" suppressHydrationWarning>
          <input
            id={hourId}
            type="number"
            min={0}
            max={23}
            placeholder="HH"
            required={required}
            className={`${inputClass} w-[70px] text-center`}
            style={{ colorScheme: "dark" }}
            value={hStr}
            onChange={(e) => setHour(e.target.value)}
            aria-label={`${timeLabel} hour`}
          />
          <span className="text-[var(--muted)]" aria-hidden>
            :
          </span>
          <input
            id={minId}
            type="number"
            min={0}
            max={59}
            placeholder="MM"
            required={required}
            className={`${inputClass} w-[70px] text-center`}
            style={{ colorScheme: "dark" }}
            value={mStr}
            onChange={(e) => setMin(e.target.value)}
            aria-label={`${timeLabel} minute`}
          />
        </div>
      </Field>
    </>
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

interface PositionFormModalProps {
  title: string;
  submitLabel: string;
  initial: PositionFormState;
  editingStatus?: Position["status"];
  onCancel: () => void;
  onSubmit: (form: PositionFormState) => void;
}

function PositionFormModal({
  title,
  submitLabel,
  initial,
  editingStatus,
  onCancel,
  onSubmit,
}: PositionFormModalProps) {
  const [form, setForm] = useState<PositionFormState>(initial);

  const set = <K extends keyof PositionFormState>(
    key: K,
    value: PositionFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const upper = (key: keyof PositionFormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => set(key, e.target.value.toUpperCase());

  const shortTotal = useMemo(
    () =>
      computeShortTotal(
        optionalNum(form.shortGain),
        optionalNum(form.shortLoss),
        optionalNum(form.shortFundingFees),
      ),
    [form.shortGain, form.shortLoss, form.shortFundingFees],
  );

  const downsideIL = useMemo(
    () => tryComputeIL(form, "down"),
    [
      form.entryPrice,
      form.bottomRange,
      form.topRange,
      form.deposited,
      form.token1Count,
      form.token2Count,
    ],
  );
  const upsideIL = useMemo(
    () => tryComputeIL(form, "up"),
    [
      form.entryPrice,
      form.bottomRange,
      form.topRange,
      form.deposited,
      form.token1Count,
      form.token2Count,
    ],
  );

  // Deposited USD is display-only, always derived from the three inputs.
  const effectiveDeposited = useMemo(
    () => formDeposited(form),
    [form.token1Count, form.entryPrice, form.token2Count, form.deposited],
  );

  const wideRangePct = useMemo(
    () => calcWideRangePercent(num(form.bottomRange), num(form.topRange)),
    [form.bottomRange, form.topRange],
  );

  const downsideProfit =
    downsideIL && effectiveDeposited > 0
      ? downsideIL.lpValue - effectiveDeposited
      : null;
  const upsideProfit =
    upsideIL && effectiveDeposited > 0
      ? upsideIL.lpValue - effectiveDeposited
      : null;

  const netDownside =
    downsideProfit === null
      ? null
      : (shortTotal ?? 0) + downsideProfit;
  const netUpside =
    upsideProfit === null ? null : (shortTotal ?? 0) + upsideProfit;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({ ...form, feeTier: normalizeFeeTier(form.feeTier) });
  };

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Position Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Pair" htmlFor="pair">
              <input
                id="pair"
                required
                className={inputClass}
                placeholder="ETH/USDC"
                value={form.pair}
                onChange={upper("pair")}
              />
            </Field>
            <Field label="Fee Tier" htmlFor="feeTier">
              <input
                id="feeTier"
                required
                className={inputClass}
                placeholder="0.05%"
                value={form.feeTier}
                onChange={(e) => set("feeTier", e.target.value)}
                onFocus={() =>
                  set("feeTier", form.feeTier.replace(/%\s*$/, ""))
                }
                onBlur={() => set("feeTier", normalizeFeeTier(form.feeTier))}
              />
            </Field>
            <Field label="Chain" htmlFor="chain">
              <input
                id="chain"
                required
                className={inputClass}
                placeholder="ETH"
                value={form.chain}
                onChange={upper("chain")}
              />
            </Field>
            <Field label="Protocol" htmlFor="protocol">
              <input
                id="protocol"
                required
                className={inputClass}
                placeholder="Aerodrome"
                value={form.protocol}
                onChange={upper("protocol")}
              />
            </Field>
            <DateTimeFields
              dateLabel="Entry Date"
              timeLabel="Entry Time (24h)"
              idPrefix="entry"
              value={form.entryDatetime}
              onChange={(v) => set("entryDatetime", v)}
              required
            />
            {editingStatus === "closed" && (
              <Field
                label="Scalp (USD)"
                htmlFor="scalp"
                hint="Positive = gain at close. Negative = loss at close."
              >
                <input
                  id="scalp"
                  type="number"
                  step="any"
                  className={inputClass}
                  placeholder="0.00"
                  value={form.scalp}
                  onChange={(e) => set("scalp", e.target.value)}
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

        <Section title="LP Range & Transaction">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Entry Price (Base)" htmlFor="entryPrice">
              <input
                id="entryPrice"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.entryPrice}
                onChange={(e) => set("entryPrice", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Range Down" htmlFor="bottomRange">
                <input
                  id="bottomRange"
                  type="number"
                  step="any"
                  required
                  className={inputClass}
                  value={form.bottomRange}
                  onChange={(e) => set("bottomRange", e.target.value)}
                />
              </Field>
              <Field label="Range Up" htmlFor="topRange">
                <input
                  id="topRange"
                  type="number"
                  step="any"
                  required
                  className={inputClass}
                  value={form.topRange}
                  onChange={(e) => set("topRange", e.target.value)}
                />
              </Field>
            </div>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Wide Range %
              </span>
              <div
                className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-sm tabular-nums text-[var(--foreground)]"
                aria-live="polite"
              >
                {wideRangePct > 0 ? formatPercent(wideRangePct) : "—"}
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                Auto: (Range Up − Range Down) / Range Down × 100
              </p>
            </div>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Deposited (USD)
              </span>
              <div
                className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-sm tabular-nums text-[var(--foreground)]"
                aria-live="polite"
              >
                {effectiveDeposited > 0 ? formatUsd(effectiveDeposited) : "—"}
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                Auto: (Base Token Count × Entry Price) + Quote Token Count
              </p>
            </div>
            <Field label="Base Token Symbol" htmlFor="token1Symbol">
              <input
                id="token1Symbol"
                required
                className={inputClass}
                placeholder="ETH"
                value={form.token1Symbol}
                onChange={upper("token1Symbol")}
              />
            </Field>
            <Field label="Quote Token Symbol" htmlFor="token2Symbol">
              <input
                id="token2Symbol"
                required
                className={inputClass}
                placeholder="USDC"
                value={form.token2Symbol}
                onChange={upper("token2Symbol")}
              />
            </Field>
            <Field label="Base Token Count" htmlFor="token1Count">
              <input
                id="token1Count"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.token1Count}
                onChange={(e) => set("token1Count", e.target.value)}
              />
            </Field>
            <Field label="Quote Token Count" htmlFor="token2Count">
              <input
                id="token2Count"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.token2Count}
                onChange={(e) => set("token2Count", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field
              label="LP Transaction Link (Optional)"
              htmlFor="txLink"
              hint="From your blockchain explorer e.g. hyperliquid.xyz, suiscan.xyz, basescan.org"
            >
              <input
                id="txLink"
                className={inputClass}
                placeholder="Paste transaction hash or explorer URL"
                value={form.txLink}
                onChange={(e) => set("txLink", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Position Hedge">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Short Position — Open Date" htmlFor="shortDateStart">
              <input
                id="shortDateStart"
                type="date"
                lang="en-GB"
                className={inputClass}
                value={form.shortDateStart}
                onChange={(e) => set("shortDateStart", e.target.value)}
              />
            </Field>
            <Field label="Short Position — Close Date" htmlFor="shortDateEnd">
              <input
                id="shortDateEnd"
                type="date"
                lang="en-GB"
                className={inputClass}
                value={form.shortDateEnd}
                onChange={(e) => set("shortDateEnd", e.target.value)}
              />
            </Field>
            <Field
              label="Short Position — Token Amount"
              htmlFor="shortTokenAmount"
            >
              <input
                id="shortTokenAmount"
                type="number"
                step="any"
                className={inputClass}
                placeholder="optional"
                value={form.shortTokenAmount}
                onChange={(e) => set("shortTokenAmount", e.target.value)}
              />
            </Field>
            <Field
              label="Short Position — USD Amount"
              htmlFor="shortUsdAmount"
            >
              <input
                id="shortUsdAmount"
                type="number"
                step="any"
                className={inputClass}
                placeholder="optional"
                value={form.shortUsdAmount}
                onChange={(e) => set("shortUsdAmount", e.target.value)}
              />
            </Field>
            <Field label="Short Position — Gain" htmlFor="shortGain">
              <input
                id="shortGain"
                type="number"
                step="any"
                className={inputClass}
                placeholder="optional"
                value={form.shortGain}
                onChange={(e) => set("shortGain", e.target.value)}
              />
            </Field>
            <Field label="Short Position — Loss" htmlFor="shortLoss">
              <input
                id="shortLoss"
                type="number"
                step="any"
                className={inputClass}
                placeholder="optional"
                value={form.shortLoss}
                onChange={(e) => set("shortLoss", e.target.value)}
              />
            </Field>
            <Field
              label="Short Position — Funding Fees"
              htmlFor="shortFundingFees"
              hint="Positive = received, Negative = paid"
            >
              <input
                id="shortFundingFees"
                type="number"
                step="any"
                className={inputClass}
                placeholder="optional"
                value={form.shortFundingFees}
                onChange={(e) => set("shortFundingFees", e.target.value)}
              />
            </Field>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Short Position — Total P&amp;L
              </span>
              <div
                className={`rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-sm tabular-nums ${
                  shortTotal === null ? "text-[var(--muted)]" : pnlColor(shortTotal)
                }`}
                aria-live="polite"
              >
                {shortTotal === null ? "—" : formatUsd(shortTotal)}
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                Auto: gain − loss + funding
              </p>
            </div>
            <Field label="Short Position — Notes" htmlFor="shortNotes">
              <textarea
                id="shortNotes"
                rows={2}
                className={inputClass}
                placeholder="optional"
                value={form.shortNotes}
                onChange={upper("shortNotes")}
              />
            </Field>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <OutOfRangeBox
              label="Out of Range — Upside"
              il={upsideIL}
              profit={upsideProfit}
              baseSymbol={form.token1Symbol}
              quoteSymbol={form.token2Symbol}
            />
            <OutOfRangeBox
              label="Out of Range — Downside"
              il={downsideIL}
              profit={downsideProfit}
              baseSymbol={form.token1Symbol}
              quoteSymbol={form.token2Symbol}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NetCoverageBox
              label="Net Downside Coverage"
              shortPresent={shortTotal !== null}
              value={netDownside}
              positiveHint="Short covers the loss"
              negativeHint="Uncovered loss remains"
              fallbackLabel="Downside P&L"
              fallbackValue={downsideProfit}
            />
            <NetCoverageBox
              label="Net Upside Coverage"
              shortPresent={shortTotal !== null}
              value={netUpside}
              positiveHint="Upside covers short loss"
              negativeHint="Short loss exceeds upside gain"
              fallbackLabel="Upside P&L"
              fallbackValue={upsideProfit}
            />
          </div>
        </Section>

        <FormActions onCancel={onCancel} submitLabel={submitLabel} />
      </form>
    </ModalShell>
  );
}

interface UpdatePositionModalProps {
  position: Position;
  derivedClaimed: number;
  onCancel: () => void;
  onSubmit: (next: {
    currentBalance: number;
    newFees: number;
  }) => void;
}

function UpdatePositionModal({
  position,
  derivedClaimed,
  onCancel,
  onSubmit,
}: UpdatePositionModalProps) {
  const [currentBalance, setCurrentBalance] = useState(
    String(position.currentBalance ?? 0),
  );
  const [newFees, setNewFees] = useState(String(position.newFees ?? 0));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({
      currentBalance: num(currentBalance),
      newFees: num(newFees),
    });
  };

  return (
    <ModalShell title={`Update — ${position.pair}`} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Routine Update">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Current Balance (USD)" htmlFor="u_currentBalance">
              <input
                id="u_currentBalance"
                type="number"
                step="any"
                required
                className={inputClass}
                value={currentBalance}
                onChange={(e) => setCurrentBalance(e.target.value)}
              />
            </Field>
            <Field label="New Fees (USD)" htmlFor="u_newFees">
              <input
                id="u_newFees"
                type="number"
                step="any"
                required
                className={inputClass}
                value={newFees}
                onChange={(e) => setNewFees(e.target.value)}
              />
            </Field>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Claimed (USD)
              </span>
              <div
                className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-sm tabular-nums text-[var(--foreground)]"
                aria-live="polite"
              >
                {formatUsd(derivedClaimed)}
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                Auto: sum of converted claims for this position. Log claims
                via the Fee Claims page or Claim button.
              </p>
            </div>
          </div>
        </Section>
        <FormActions onCancel={onCancel} submitLabel="Save" />
      </form>
    </ModalShell>
  );
}

interface ClosePositionModalProps {
  position: Position;
  onCancel: () => void;
  onSubmit: (next: {
    exitDatetime: string;
    currentBalance: number;
    scalp: number | null;
    feeClaim?: {
      token1Amount: number;
      token2Amount: number;
      stableAmount: number | null;
      convertedToStable: boolean;
      stableSymbol: string | null;
      txId: string | null;
    };
  }) => void;
}

function ClosePositionModal({
  position,
  onCancel,
  onSubmit,
}: ClosePositionModalProps) {
  const [exitDatetime, setExitDatetime] = useState(nowDatetimeLocal());
  const [scalp, setScalp] = useState("");
  const [currentBalance, setCurrentBalance] = useState(
    String(position.currentBalance ?? 0),
  );
  const [claimSectionOpen, setClaimSectionOpen] = useState(false);
  const [claimTokens1, setClaimTokens1] = useState("");
  const [claimTokens2, setClaimTokens2] = useState("");
  const [claimUsdValue, setClaimUsdValue] = useState("");
  const [claimConverted, setClaimConverted] = useState(false);
  const [claimStableSymbol, setClaimStableSymbol] = useState("USDC");
  const [claimTxId, setClaimTxId] = useState("");

  const shouldCreateClaim =
    num(claimTokens1) > 0 || num(claimTokens2) > 0 || num(claimUsdValue) > 0;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({
      exitDatetime: new Date(exitDatetime).toISOString(),
      currentBalance: num(currentBalance),
      scalp: optionalNum(scalp),
      feeClaim: shouldCreateClaim
        ? {
            token1Amount: num(claimTokens1),
            token2Amount: num(claimTokens2),
            stableAmount: optionalNum(claimUsdValue),
            convertedToStable: claimConverted,
            stableSymbol: claimConverted
              ? claimStableSymbol.trim().toUpperCase() || null
              : null,
            txId: claimTxId.trim() === "" ? null : claimTxId.trim(),
          }
        : undefined,
    });
  };

  return (
    <ModalShell title={`Close — ${position.pair}`} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Confirm Close">
          <p className="mb-4 text-sm text-[var(--muted)]">
            Closing{" "}
            <span className="font-medium text-[var(--foreground)]">
              {position.pair}
            </span>{" "}
            on {position.chain} ({position.protocol}). This sets the exit time
            and marks the position as closed.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DateTimeFields
              dateLabel="Exit Date"
              timeLabel="Exit Time (24h)"
              idPrefix="exit"
              value={exitDatetime}
              onChange={setExitDatetime}
              required
            />
            <Field
              label="Scalp (USD)"
              htmlFor="c_scalp"
              hint="Positive = realized gain at close. Negative = realized loss at close. Leave blank if no scalp event."
            >
              <input
                id="c_scalp"
                type="number"
                step="any"
                className={inputClass}
                placeholder="0.00"
                value={scalp}
                onChange={(e) => setScalp(e.target.value)}
              />
            </Field>
            <Field label="Final Current Balance (USD)" htmlFor="c_balance">
              <input
                id="c_balance"
                type="number"
                step="any"
                required
                className={inputClass}
                value={currentBalance}
                onChange={(e) => setCurrentBalance(e.target.value)}
              />
            </Field>
          </div>
        </Section>
        <Section title="Claim Fees at Close (Optional)">
          <button
            type="button"
            onClick={() => setClaimSectionOpen((v) => !v)}
            aria-expanded={claimSectionOpen}
            className="text-sm font-medium text-[var(--accent)] hover:opacity-80"
          >
            {claimSectionOpen ? "−" : "+"} Claim fees earned at close?
          </button>
          {claimSectionOpen && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={`${position.token1Symbol || "Token 1"} Amount`}
                  htmlFor="c_claimTokens1"
                >
                  <input
                    id="c_claimTokens1"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    className={inputClass}
                    value={claimTokens1}
                    onChange={(e) => setClaimTokens1(e.target.value)}
                  />
                </Field>
                <Field
                  label={`${position.token2Symbol || "Token 2"} Amount`}
                  htmlFor="c_claimTokens2"
                >
                  <input
                    id="c_claimTokens2"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    className={inputClass}
                    value={claimTokens2}
                    onChange={(e) => setClaimTokens2(e.target.value)}
                  />
                </Field>
                <Field
                  label="Claim USD Value"
                  htmlFor="c_claimUsd"
                  hint="USD value of these fees at close time"
                >
                  <input
                    id="c_claimUsd"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    className={inputClass}
                    value={claimUsdValue}
                    onChange={(e) => setClaimUsdValue(e.target.value)}
                  />
                </Field>
                <Field label="Transaction ID (Optional)" htmlFor="c_claimTx">
                  <input
                    id="c_claimTx"
                    className={inputClass}
                    placeholder="Paste tx hash or explorer URL"
                    value={claimTxId}
                    onChange={(e) => setClaimTxId(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-[var(--muted)]">
                  Converted to Stablecoin?
                </span>
                <div
                  role="radiogroup"
                  aria-label="Converted to Stablecoin?"
                  className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={claimConverted}
                    onClick={() => setClaimConverted(true)}
                    className={`h-8 px-4 text-xs font-medium transition-colors ${
                      claimConverted
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!claimConverted}
                    onClick={() => setClaimConverted(false)}
                    className={`h-8 px-4 text-xs font-medium border-l border-[var(--border-strong)] transition-colors ${
                      !claimConverted
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
                    }`}
                  >
                    No
                  </button>
                </div>
                {claimConverted && (
                  <input
                    aria-label="Stable symbol"
                    className={`${inputClass} w-28`}
                    placeholder="USDC"
                    value={claimStableSymbol}
                    onChange={(e) =>
                      setClaimStableSymbol(e.target.value.toUpperCase())
                    }
                  />
                )}
              </div>
            </div>
          )}
        </Section>
        <FormActions
          onCancel={onCancel}
          submitLabel="Confirm Close"
          submitTone="danger"
        />
      </form>
    </ModalShell>
  );
}

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

function fmtTokenAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

interface OutOfRangeBoxProps {
  label: string;
  il: ILResult | null;
  profit: number | null;
  baseSymbol: string;
  quoteSymbol: string;
}

function OutOfRangeBox({
  label,
  il,
  profit,
  baseSymbol,
  quoteSymbol,
}: OutOfRangeBoxProps) {
  const ready = il !== null && profit !== null;
  return (
    <div className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/40 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      {ready ? (
        <div className="mt-1.5 space-y-1">
          <div className="text-sm font-medium text-[var(--foreground)] tabular-nums">
            {(() => {
              const showT0 = il.futureToken0 > 0;
              const showT1 = il.futureToken1 > 0;
              if (!showT0 && !showT1) return "—";
              return (
                <>
                  {showT0 && (
                    <>
                      {fmtTokenAmount(il.futureToken0)}{" "}
                      <span className="text-[var(--muted)]">
                        {baseSymbol || "—"}
                      </span>
                    </>
                  )}
                  {showT0 && showT1 && " + "}
                  {showT1 && (
                    <>
                      {fmtTokenAmount(il.futureToken1)}{" "}
                      <span className="text-[var(--muted)]">
                        {quoteSymbol || "—"}
                      </span>
                    </>
                  )}
                </>
              );
            })()}
          </div>
          <div className="text-xs text-[var(--muted)] tabular-nums">
            LP Value: {formatUsd(il.lpValue)}
          </div>
          <div className={`text-xs tabular-nums font-medium ${pnlColor(profit)}`}>
            P/L: {formatUsd(profit)}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-sm text-[var(--muted)]">—</div>
      )}
    </div>
  );
}

interface NetCoverageBoxProps {
  label: string;
  shortPresent: boolean;
  value: number | null;
  positiveHint: string;
  negativeHint: string;
  fallbackLabel: string;
  fallbackValue: number | null;
}

function NetCoverageBox({
  label,
  shortPresent,
  value,
  positiveHint,
  negativeHint,
  fallbackLabel,
  fallbackValue,
}: NetCoverageBoxProps) {
  const showFallback = !shortPresent && fallbackValue !== null;
  const displayValue = shortPresent ? value : fallbackValue;
  const isMissing = displayValue === null;
  const tone = isMissing ? "text-[var(--muted)]" : pnlColor(displayValue);
  const hint = isMissing
    ? null
    : displayValue > 0
      ? positiveHint
      : displayValue < 0
        ? negativeHint
        : null;

  return (
    <div className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)]/60 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div
        className={`mt-1.5 text-sm font-semibold tabular-nums ${tone}`}
        aria-live="polite"
      >
        {isMissing
          ? "—"
          : showFallback
            ? `${fallbackLabel} = ${formatUsd(displayValue)}`
            : `Short P&L + ${label.includes("Down") ? "Downside" : "Upside"} = ${formatUsd(displayValue)}`}
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        {showFallback
          ? "No short position — showing raw P&L"
          : hint ?? "Add a short and out-of-range data to see coverage"}
      </p>
    </div>
  );
}

interface FormActionsProps {
  onCancel: () => void;
  submitLabel: string;
  submitTone?: "primary" | "danger";
}

function FormActions({
  onCancel,
  submitLabel,
  submitTone = "primary",
}: FormActionsProps) {
  const submitClass =
    submitTone === "danger"
      ? "bg-rose-500 hover:bg-rose-500/90 text-white"
      : "bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white";
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
        className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm transition-colors ${submitClass}`}
      >
        {submitLabel}
      </button>
    </div>
  );
}
