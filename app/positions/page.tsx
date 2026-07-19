"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getClaims,
  getPoolPnL,
  getPositions,
  getPositionPrices,
  getRanges,
  savePoolPnL,
  savePositions,
  savePositionPrices,
  saveRanges,
} from "../../lib/storage";
import {
  calcDaysActive,
  calcFeeAPR,
  calcPositionProfit,
  calcPriceDiff,
  calcRangeHealth,
  calcTotalFees,
  calcWideRangePercent,
  computePositionIL,
  depositedFromLiquidity,
  entryPriceFromDeposited,
  entryPriceFromTokens,
  getEffectiveClaimed,
  getEffectiveDeposited,
  getEffectiveTotalFees,
  liquidityFromDeposited,
  splitDepositedIntoTokens,
  type EntryPriceFromTokens,
  type ILResult,
  type TokenSplit,
  type RangeHealth,
  type RangeStatus,
} from "../../lib/calculations";
import {
  ClaimFormModal,
  persistNewClaim,
} from "../../components/ClaimFormModal";
import { useHydrated } from "../../lib/useHydrated";
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

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
// mirrors getEffectiveDeposited in lib/calculations. Takes primitive fields
// rather than the whole form so memoized callers can declare exact deps.
function formDeposited(
  token1Count: string,
  entryPrice: string,
  token2Count: string,
  deposited: string,
): number {
  const base = num(token1Count);
  const entry = num(entryPrice);
  const quote = num(token2Count);
  const computed =
    (base > 0 && entry > 0 ? base * entry : 0) + (quote > 0 ? quote : 0);
  return computed > 0 ? computed : num(deposited);
}

// Token counts and Deposited are written back into number inputs when the
// other side is edited, so they need trimming — a raw String(2.4000000000004)
// is a legal but unreadable field value.
function formatAmountInput(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return String(Number(value.toFixed(decimals)));
}

// The token counts an auto-split replaced, kept only to show them back to
// the user in the amber note.
interface TokenSplitWarning {
  base: string;
  quote: string;
}

// What a confirmed recalculation replaced, kept to report it back after the
// panel closes.
interface RecalcSummary {
  fromEntry: string;
  toEntry: string;
  fromDeposited: string;
  toDeposited: string;
  // Whether Current Balance moved with the correction, and if it did not,
  // the stale figure the user needs to review.
  balanceMoved: boolean;
  staleBalance: string | null;
}

// The one path where Edit mode may rewrite a recorded Entry Price and
// Deposited together. Everything here works on a local draft so that
// cancelling touches nothing, and the solved result is shown as an explicit
// old → new comparison that the user must confirm before it reaches the form.
function RecalcFromTokensPanel({
  rangeDown,
  rangeUp,
  currentEntryPrice,
  currentDeposited,
  savedCurrentBalance,
  balanceTracksDeposited,
  baseSymbol,
  quoteSymbol,
  initialBase,
  initialQuote,
  onApply,
  onCancel,
}: {
  rangeDown: number;
  rangeUp: number;
  currentEntryPrice: number;
  currentDeposited: number;
  savedCurrentBalance: number;
  // True when the saved Current Balance still equals the saved Deposited —
  // i.e. it has never been independently updated and is only a default.
  balanceTracksDeposited: boolean;
  baseSymbol: string;
  quoteSymbol: string;
  initialBase: string;
  initialQuote: string;
  onApply: (
    entryPrice: number,
    deposited: number,
    base: string,
    quote: string,
    newCurrentBalance: number | null,
  ) => void;
  onCancel: () => void;
}) {
  const [base, setBase] = useState(initialBase);
  const [quote, setQuote] = useState(initialQuote);

  const solved = useMemo(
    () => entryPriceFromTokens(num(base), num(quote), rangeDown, rangeUp),
    [base, quote, rangeDown, rangeUp],
  );
  const newDeposited =
    solved !== null ? num(base) * solved.entryPrice + num(quote) : null;

  const entryChanges =
    solved !== null && solved.entryPrice.toFixed(6) !== currentEntryPrice.toFixed(6);
  const depositedChanges =
    newDeposited !== null && newDeposited.toFixed(2) !== currentDeposited.toFixed(2);
  // Profit = Current Balance − Deposited, so correcting Deposited alone
  // invents profit. When the balance was only ever a default copy of the
  // deposit it moves with the correction and profit stays at zero; when it
  // holds real tracked data it is left alone and the user is told why.
  const balanceChanges = balanceTracksDeposited && depositedChanges;

  return (
    <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-4">
      <h4 className="text-[13px] font-semibold text-[var(--foreground)]">
        Recalculate from token amounts
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        Use this when the saved record itself is wrong — not to fix a typo.
        Enter the token amounts you know are correct and the entry price will
        be solved from them, then Deposited recalculated. This is the only
        place editing a position can change Deposited.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={`Base Token Count${baseSymbol ? ` (${baseSymbol})` : ""}`}
          htmlFor="recalcBase"
        >
          <input
            id="recalcBase"
            type="number"
            step="any"
            className={inputClass}
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </Field>
        <Field
          label={`Quote Token Count${quoteSymbol ? ` (${quoteSymbol})` : ""}`}
          htmlFor="recalcQuote"
        >
          <input
            id="recalcQuote"
            type="number"
            step="any"
            className={inputClass}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
          />
        </Field>
      </div>

      {solved === null ? (
        <p className="mt-3 text-[12px] text-amber-300" role="status">
          {num(base) === 0 && num(quote) === 0
            ? "Enter at least one token amount."
            : "Cannot solve an entry price from these amounts. Check both range bounds are set and Range Up is above Range Down."}
        </p>
      ) : (
        <div className="mt-3 space-y-2" aria-live="polite">
          {solved.shape !== "two-sided" && (
            <p className="text-[11px] text-[var(--muted)]">
              Only one token entered, so the entry price is the{" "}
              {solved.shape === "base-only" ? "bottom" : "top"} of your range —
              the only point where a position holds{" "}
              {solved.shape === "base-only"
                ? `100% ${baseSymbol || "base token"}`
                : `100% ${quoteSymbol || "quote token"}`}
              .
            </p>
          )}
          <dl className="rounded border border-[var(--border-strong)] bg-[var(--surface-2)]/50 px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between gap-3 py-0.5">
              <dt className="text-[var(--muted)]">Entry Price</dt>
              <dd className="tabular-nums">
                <span className={entryChanges ? "text-[var(--muted)] line-through" : ""}>
                  {currentEntryPrice > 0 ? currentEntryPrice : "—"}
                </span>
                {entryChanges && (
                  <span className="ml-2 font-medium text-amber-300">
                    {formatAmountInput(solved.entryPrice, 6)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-0.5">
              <dt className="text-[var(--muted)]">Deposited (USD)</dt>
              <dd className="tabular-nums">
                <span className={depositedChanges ? "text-[var(--muted)] line-through" : ""}>
                  {currentDeposited > 0 ? formatUsd(currentDeposited) : "—"}
                </span>
                {depositedChanges && newDeposited !== null && (
                  <span className="ml-2 font-medium text-amber-300">
                    {formatUsd(newDeposited)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-0.5">
              <dt className="text-[var(--muted)]">Current Balance</dt>
              <dd className="tabular-nums">
                <span className={balanceChanges ? "text-[var(--muted)] line-through" : ""}>
                  {formatUsd(savedCurrentBalance)}
                </span>
                {balanceChanges && newDeposited !== null && (
                  <span className="ml-2 font-medium text-amber-300">
                    {formatUsd(newDeposited)}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {depositedChanges && !balanceTracksDeposited && (
            <p className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              Current Balance ({formatUsd(savedCurrentBalance)}) holds real
              tracked data from a previous Update, so it is left untouched.
              Because Profit is Current Balance minus Deposited, this position
              will show a Profit that shifts by{" "}
              {newDeposited !== null
                ? formatUsd(currentDeposited - newDeposited)
                : "—"}{" "}
              from this correction alone. Run Update on the position afterwards
              to record its real current value.
            </p>
          )}
          {balanceChanges && (
            <p className="text-[11px] text-[var(--muted)]">
              Current Balance still equals Deposited, so it has never been
              updated on its own — it moves with the correction and Profit
              stays at zero.
            </p>
          )}
          {!entryChanges && !depositedChanges && (
            <p className="text-[11px] text-[var(--muted)]">
              These amounts match what is already recorded — nothing would
              change.
            </p>
          )}
          <p className="text-[11px] text-[var(--muted)]">
            Applying replaces the recorded values when you save this position.
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={solved === null || newDeposited === null}
          onClick={() => {
            if (solved === null || newDeposited === null) return;
            onApply(
              solved.entryPrice,
              newDeposited,
              base,
              quote,
              balanceChanges ? newDeposited : null,
            );
          }}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-[12px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply recalculation
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Chooses which fields drive the LP Range section. Add-position only.
function InputModeTabs({
  mode,
  onChange,
}: {
  mode: "price" | "tokens";
  onChange: (mode: "price" | "tokens") => void;
}) {
  const tabs: { key: "price" | "tokens"; label: string }[] = [
    { key: "price", label: "Price & deposit" },
    { key: "tokens", label: "Token amounts" },
  ];
  return (
    <div className="mb-4 space-y-1.5">
      <div
        role="tablist"
        aria-label="Position input method"
        className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)]/40 p-0.5"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            onClick={() => onChange(tab.key)}
            className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
              mode === tab.key
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        {mode === "price"
          ? "Type an entry price or a deposit — the token amounts follow."
          : "Type the exact token amounts from your transaction — the entry price is solved from them."}
      </p>
    </div>
  );
}

// Parses form strings, then delegates to the shared computePositionIL in
// lib/calculations (Invariant #6 — one IL source of truth across pages).
// Form naming: token1 = base token (calcIL token0), token2 = quote token
// (calcIL token1, priced at $1 by convention). Takes primitive fields rather
// than the whole form so memoized callers can declare exact deps.
function tryComputeIL(
  entryPrice: string,
  bottomRange: string,
  topRange: string,
  token1Count: string,
  token2Count: string,
  deposited: string,
  side: "down" | "up",
): ILResult | null {
  if ([entryPrice, bottomRange, topRange].some((v) => v.trim() === "")) {
    return null;
  }
  const rangeDown = Number(bottomRange);
  const rangeUp = Number(topRange);
  return computePositionIL(
    {
      entryPrice: Number(entryPrice),
      rangeDown,
      rangeUp,
      deposited: formDeposited(token1Count, entryPrice, token2Count, deposited),
      token0Count: num(token1Count),
      token1Count: num(token2Count),
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
  // Empty unless a confirmed recalculation decided Current Balance should
  // move with the correction. Never a visible field.
  currentBalanceOverride: string;
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
  currentBalanceOverride: "",
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
    // Seed the (now editable) Deposited input from the derived value, not
    // the raw stored one, so legacy records open showing corrected money.
    // Trimmed to cents — the derivation leaves float noise the field would
    // otherwise show as 10927.460001309999.
    deposited: formatAmountInput(getEffectiveDeposited(p), 2),
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
    currentBalanceOverride: "",
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
  const deposited = formDeposited(
    form.token1Count,
    form.entryPrice,
    form.token2Count,
    form.deposited,
  );
  const sGain = optionalNum(form.shortGain);
  const sLoss = optionalNum(form.shortLoss);
  const sFunding = optionalNum(form.shortFundingFees);
  const sTotal = computeShortTotal(sGain, sLoss, sFunding);
  // Stored outOfRangeUpside/Downside are last-computed values and may be
  // stale — readers must always prefer live recomputation via
  // computePositionIL and only fall back to these on corrupt/incomplete
  // records.
  const upIL = tryComputeIL(
    form.entryPrice,
    form.bottomRange,
    form.topRange,
    form.token1Count,
    form.token2Count,
    form.deposited,
    "up",
  );
  const downIL = tryComputeIL(
    form.entryPrice,
    form.bottomRange,
    form.topRange,
    form.token1Count,
    form.token2Count,
    form.deposited,
    "down",
  );
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
    // Normally carried through untouched on edit. The one exception is a
    // confirmed token-amount recalculation on a position whose balance had
    // never been independently updated — see currentBalanceOverride.
    currentBalance:
      form.currentBalanceOverride !== ""
        ? num(form.currentBalanceOverride)
        : (base?.currentBalance ?? deposited),
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
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [showClosed, setShowClosed] = useState(false);
  const [fetchedPrices, setFetchedPrices] = useState<Record<string, number>>(
    {},
  );
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>(
    {},
  );
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<string | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const refresh = () => {
    setPositions(getPositions());
    setClaims(getClaims());
    setPositionPrices(getPositionPrices());
  };

  // Fetch live USD prices for every token used by active positions, reusing
  // the Sprint 8.5 /api/prices route. A pair's current price is then
  // usd(base) / usd(quote), computed in currentPriceById below.
  const refreshPrices = useCallback(async (allPositions: Position[]) => {
    const symbols = new Set<string>();
    for (const p of allPositions) {
      if (p.status !== "active") continue;
      const b = p.token1Symbol.trim().toUpperCase();
      const q = p.token2Symbol.trim().toUpperCase();
      if (b) symbols.add(b);
      if (q) symbols.add(q);
    }
    if (symbols.size === 0) return;
    setPriceLoading(true);
    try {
      const res = await fetch(
        `/api/prices?symbols=${encodeURIComponent([...symbols].join(","))}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        prices: Record<string, number>;
        updatedAt: string;
      };
      setFetchedPrices(data.prices ?? {});
      setPriceUpdatedAt(data.updatedAt ?? new Date().toISOString());
    } catch {
      // Leave prices empty; positions fall back to manual current price.
    } finally {
      setPriceLoading(false);
    }
  }, []);

  const hydrated = useHydrated(() => {
    const loaded = getPositions();
    setPositions(loaded);
    setClaims(getClaims());
    setPositionPrices(getPositionPrices());
    void refreshPrices(loaded);
  });

  // Current pair price per position: manual override wins, else fetched
  // base/quote ratio (stablecoin quote → base price directly). null = unknown.
  const currentPriceById = useMemo(() => {
    const STABLES = new Set(["USDC", "USDT", "DAI", "USD"]);
    const map = new Map<string, number | null>();
    for (const p of positions) {
      const manual = positionPrices[p.id];
      if (Number.isFinite(manual) && manual > 0) {
        map.set(p.id, manual);
        continue;
      }
      const base = p.token1Symbol.trim().toUpperCase();
      const quote = p.token2Symbol.trim().toUpperCase();
      const basePrice = fetchedPrices[base];
      const quotePrice = STABLES.has(quote) ? 1 : fetchedPrices[quote];
      if (
        Number.isFinite(basePrice) &&
        basePrice > 0 &&
        Number.isFinite(quotePrice) &&
        quotePrice > 0
      ) {
        map.set(p.id, basePrice / quotePrice);
      } else {
        map.set(p.id, null);
      }
    }
    return map;
  }, [positions, positionPrices, fetchedPrices]);

  const healthById = useMemo(() => {
    const map = new Map<string, RangeHealth>();
    for (const p of positions) {
      map.set(
        p.id,
        calcRangeHealth(
          currentPriceById.get(p.id) ?? null,
          p.bottomRange,
          p.topRange,
        ),
      );
    }
    return map;
  }, [positions, currentPriceById]);

  const setPositionPrice = (positionId: string, raw: string) => {
    const next = { ...positionPrices };
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
      delete next[positionId];
    } else {
      next[positionId] = value;
    }
    setPositionPrices(next);
    savePositionPrices(next);
  };

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

      {active.length > 0 && (
        <RangeHealthSummary
          rows={active}
          healthById={healthById}
          priceLoading={priceLoading}
          priceUpdatedAt={priceUpdatedAt}
          onRefresh={() => void refreshPrices(positions)}
        />
      )}

      <PositionsTable
        title="Active Positions"
        rows={active}
        variant="active"
        healthById={healthById}
        onSetPrice={setPositionPrice}
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
        onEdit={(p) => setModal({ kind: "edit", position: p })}
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
          savedDeposited={modal.position.deposited}
          savedCurrentBalance={modal.position.currentBalance}
          exitDatetime={modal.position.exitDatetime}
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

function rangeStatusMeta(status: RangeHealth["status"]): {
  label: string;
  cls: string;
} {
  switch (status) {
    case "safe":
      return {
        label: "In Range",
        cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
      };
    case "close":
      return {
        label: "Getting Close",
        cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
      };
    case "out":
      return {
        label: "Out of Range",
        cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
      };
    default:
      return {
        label: "Price needed",
        cls: "bg-[var(--surface-2)] text-[var(--muted)] ring-[var(--border-strong)]",
      };
  }
}

function rangeHealthDetail(health: RangeHealth): string {
  if (health.status === "out") {
    return health.distanceToLowerPct !== null && health.distanceToLowerPct < 0
      ? "below range"
      : "above range";
  }
  if (health.nearestEdgePct === null) return "";
  return `${health.nearestEdgePct.toFixed(1)}% to edge`;
}

function RangeBadge({ status }: { status: RangeHealth["status"] }) {
  const meta = rangeStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset whitespace-nowrap ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

// Prices are quote-per-base, not USD — formatted as plain numbers with
// enough precision for low-priced pairs without trailing noise on large ones.
function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const decimals = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

const RANGE_BAR_TONE: Record<RangeStatus, { fill: string; text: string }> = {
  safe: { fill: "bg-emerald-400", text: "text-emerald-300" },
  close: { fill: "bg-amber-400", text: "text-amber-300" },
  out: { fill: "bg-rose-400", text: "text-rose-300" },
  unknown: { fill: "bg-[var(--muted)]", text: "text-[var(--muted)]" },
};

// Where price sits between the range bounds, drawn rather than described.
// bandPosition is 0 at the bottom edge and 1 at the top; it runs outside that
// when a position has drifted out of range, so the marker is clamped to the
// track and the caption carries the real distance.
function RangeBar({
  health,
  entryPrice,
  rangeDown,
  rangeUp,
}: {
  health: RangeHealth;
  entryPrice: number;
  rangeDown: number;
  rangeUp: number;
}) {
  const span = rangeUp - rangeDown;
  const tone = RANGE_BAR_TONE[health.status];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const pricePct =
    health.bandPosition === null ? null : clamp(health.bandPosition) * 100;
  const entryPct = span > 0 ? clamp((entryPrice - rangeDown) / span) * 100 : null;

  return (
    <div className="mt-3">
      <div className="relative h-1.5 rounded-full bg-[var(--surface-2)]">
        {entryPct !== null && (
          <span
            className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--muted)]/70"
            style={{ left: `${entryPct}%` }}
            aria-hidden
          />
        )}
        {pricePct !== null && (
          <span
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)] ${tone.fill}`}
            style={{ left: `${pricePct}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-[var(--muted)]">
        <span>{formatPrice(rangeDown)}</span>
        <span className={tone.text}>{rangeHealthDetail(health)}</span>
        <span>{formatPrice(rangeUp)}</span>
      </div>
    </div>
  );
}

interface RangeHealthSummaryProps {
  rows: DerivedRow[];
  healthById: Map<string, RangeHealth>;
  priceLoading: boolean;
  priceUpdatedAt: string | null;
  onRefresh: () => void;
}

function RangeHealthSummary({
  rows,
  healthById,
  priceLoading,
  priceUpdatedAt,
  onRefresh,
}: RangeHealthSummaryProps) {
  let out = 0;
  let close = 0;
  let safe = 0;
  let unknown = 0;
  const atRisk: Array<{ position: Position; health: RangeHealth }> = [];
  for (const { position } of rows) {
    const health = healthById.get(position.id);
    if (!health || health.status === "unknown") {
      unknown += 1;
      continue;
    }
    if (health.status === "out") {
      out += 1;
      atRisk.push({ position, health });
    } else if (health.status === "close") {
      close += 1;
      atRisk.push({ position, health });
    } else {
      safe += 1;
    }
  }
  atRisk.sort(
    (a, b) => (a.health.nearestEdgePct ?? 0) - (b.health.nearestEdgePct ?? 0),
  );

  const updatedLabel = priceLoading
    ? "Updating prices…"
    : priceUpdatedAt
      ? `Prices updated ${formatUpdatedAt(priceUpdatedAt)}`
      : "Prices not fetched yet";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Range Health</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            How close each active position is to going out of its range
            (auto-priced; type a price where none is available).
          </p>
        </div>
        <div className="flex items-center gap-3 whitespace-nowrap">
          <span className="text-xs text-[var(--muted)]">{updatedLabel}</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={priceLoading}
            className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
        <RangeCount label="Out of Range" value={out} tone="rose" />
        <RangeCount label="Getting Close" value={close} tone="amber" />
        <RangeCount label="In Range" value={safe} tone="emerald" />
        <RangeCount label="Price Needed" value={unknown} tone="muted" />
      </div>
      {atRisk.length > 0 && (
        <div className="border-t border-[var(--border)] px-5 py-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Needs attention (closest to the edge first)
          </p>
          <ul className="space-y-1.5">
            {atRisk.map(({ position, health }) => (
              <li
                key={position.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <RangeBadge status={health.status} />
                  <span className="font-medium">{position.pair}</span>
                  <span className="text-[var(--muted)]">
                    ({position.chain})
                  </span>
                </span>
                <span className="text-xs text-[var(--muted)] tabular-nums">
                  {rangeHealthDetail(health)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RangeCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "muted";
}) {
  const toneCls: Record<typeof tone, string> = {
    rose: "text-rose-300",
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    muted: "text-[var(--muted)]",
  };
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)]/40 px-3 py-2.5 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${toneCls[tone]}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}

interface PositionsTableProps {
  title: string;
  rows: DerivedRow[];
  variant: "active" | "closed";
  healthById?: Map<string, RangeHealth>;
  onSetPrice?: (positionId: string, raw: string) => void;
  onEdit?: (p: Position) => void;
  onUpdate?: (p: Position) => void;
  onClose?: (p: Position) => void;
  onClaim?: (p: Position) => void;
  emptyText: string;
}

// One metric in the card's grid. Kept tiny so the grid stays declarative.
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm tabular-nums ${tone ?? "text-[var(--foreground)]"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function PositionCard({
  row,
  variant,
  health,
  onSetPrice,
  onEdit,
  onUpdate,
  onClose,
  onClaim,
}: {
  row: DerivedRow;
  variant: "active" | "closed";
  health?: RangeHealth;
  onSetPrice?: (raw: string) => void;
  onEdit?: (p: Position) => void;
  onUpdate?: (p: Position) => void;
  onClose?: (p: Position) => void;
  onClaim?: (p: Position) => void;
}) {
  const { position, deposited, claimed, fees, days, apr, priceDiff, profit } = row;
  const [showDetails, setShowDetails] = useState(false);
  const wideRange = calcWideRangePercent(position.bottomRange, position.topRange);
  const isActive = variant === "active";
  // Closed positions are dimmed but never hidden (Invariant #4).
  const priceUnresolved = isActive && (!health || health.status === "unknown");

  return (
    <article
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)] ${
        isActive ? "" : "opacity-75 hover:opacity-100"
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
            <span className="truncate">{position.pair}</span>
            <TxLinkBadge value={position.txLink ?? null} />
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {position.chain} · {position.protocol}
          </p>
        </div>
        {isActive ? (
          priceUnresolved ? (
            <input
              type="number"
              step="any"
              min="0"
              placeholder="current price"
              aria-label={`Current price for ${position.pair}`}
              className={`${inputClass} w-28 text-right`}
              onBlur={(e) => onSetPrice?.(e.target.value)}
            />
          ) : (
            <RangeBadge status={health!.status} />
          )
        ) : (
          <div className="text-right text-[11px] text-[var(--muted)]">
            <div className="tabular-nums">
              {formatDateTime24(position.exitDatetime)}
            </div>
            <div className="text-[var(--muted)]/80">
              {days.toFixed(1)} days held
            </div>
          </div>
        )}
      </header>

      {isActive && health && health.status !== "unknown" && (
        <RangeBar
          health={health}
          entryPrice={position.entryPrice}
          rangeDown={position.bottomRange}
          rangeUp={position.topRange}
        />
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Metric label="Deposited" value={formatUsd(deposited)} />
        <Metric label="Current" value={formatUsd(position.currentBalance)} />
        <Metric
          label="Profit"
          value={formatUsd(profit)}
          tone={`font-medium ${pnlColor(profit)}`}
        />
        <Metric label="Total Fees" value={formatUsd(fees)} />
        <Metric label="Fee APR" value={formatPercent(apr)} />
        {isActive ? (
          <Metric label="Days Active" value={days.toFixed(1)} />
        ) : (
          <Metric
            label="Scalp"
            value={formatUsd(position.scalp ?? 0)}
            tone={`font-medium ${pnlColor(position.scalp ?? 0)}`}
          />
        )}
      </dl>

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="mt-3 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
      >
        {showDetails ? "Hide details" : "Details"} {showDetails ? "▴" : "▾"}
      </button>

      {showDetails && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border)] pt-3 sm:grid-cols-3">
          <Metric label="New Fees" value={formatUsd(position.newFees)} />
          <Metric label="Claimed" value={formatUsd(claimed)} />
          <Metric
            label="Price Diff"
            value={formatUsd(priceDiff)}
            tone={`font-medium ${pnlColor(priceDiff)}`}
          />
          <Metric label="Entry Price" value={formatPrice(position.entryPrice)} />
          <Metric
            label="Range"
            value={`${formatPrice(position.bottomRange)} – ${formatPrice(position.topRange)}`}
          />
          <Metric
            label="Range %"
            value={wideRange > 0 ? formatPercent(wideRange) : "—"}
          />
        </dl>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => onEdit?.(position)}
          className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
        >
          Edit
        </button>
        {isActive && (
          <button
            type="button"
            onClick={() => onUpdate?.(position)}
            className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
          >
            Update
          </button>
        )}
        <button
          type="button"
          onClick={() => onClaim?.(position)}
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
        >
          Claim
        </button>
        {isActive && (
          <button
            type="button"
            onClick={() => onClose?.(position)}
            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
          >
            Close
          </button>
        )}
      </div>
    </article>
  );
}

function PositionsTable({
  title,
  rows,
  variant,
  healthById,
  onSetPrice,
  onEdit,
  onUpdate,
  onClose,
  onClaim,
  emptyText,
}: PositionsTableProps) {
  return (
    <div>
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <span className="text-xs text-[var(--muted)]">
            {rows.length} {rows.length === 1 ? "position" : "positions"}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--muted)]">
          {emptyText}
        </div>
      ) : (
        // items-start so expanding one card's details does not stretch its
        // row-mates into tall cards with dead space under the buttons.
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <PositionCard
              key={row.position.id}
              row={row}
              variant={variant}
              health={healthById?.get(row.position.id)}
              onSetPrice={
                onSetPrice ? (raw) => onSetPrice(row.position.id, raw) : undefined
              }
              onEdit={onEdit}
              onUpdate={onUpdate}
              onClose={onClose}
              onClaim={onClaim}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ClosedSectionProps {
  rows: DerivedRow[];
  open: boolean;
  onToggle: () => void;
  onEdit?: (p: Position) => void;
  onClaim?: (p: Position) => void;
}

function ClosedSection({
  rows,
  open,
  onToggle,
  onEdit,
  onClaim,
}: ClosedSectionProps) {
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
            onEdit={onEdit}
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

// Plausibility warning (Invariant #8): exit before entry is impossible but
// was silently accepted — Days Active clamps to 0 and APR reads 0%. Warns
// without blocking so users can still correct whichever date is wrong.
function DateOrderWarning({
  entry,
  exit,
}: {
  entry: string;
  exit: string | null | undefined;
}) {
  if (!entry || !exit) return null;
  const entryMs = new Date(entry).getTime();
  const exitMs = new Date(exit).getTime();
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs)) return null;
  if (exitMs >= entryMs) return null;
  return (
    <p className="text-xs font-medium text-amber-400 sm:col-span-2">
      ⚠ Exit date is earlier than entry date — Days Active will count as 0 and
      Fee APR will show 0%. Please check the dates.
    </p>
  );
}

const inputClass =
  "block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 [color-scheme:dark] caret-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

interface PositionFormModalProps {
  title: string;
  submitLabel: string;
  initial: PositionFormState;
  editingStatus?: Position["status"];
  exitDatetime?: string | null;
  // Raw stored values of the position being edited. The recalculation's
  // case decision compares these two directly — NOT the derived Deposited,
  // which can differ from the stored figure by rounding and would
  // misclassify an untouched balance as real tracked data.
  savedDeposited?: number;
  savedCurrentBalance?: number;
  onCancel: () => void;
  onSubmit: (form: PositionFormState) => void;
}

function PositionFormModal({
  title,
  submitLabel,
  initial,
  editingStatus,
  exitDatetime,
  savedDeposited,
  savedCurrentBalance,
  onCancel,
  onSubmit,
}: PositionFormModalProps) {
  const [form, setForm] = useState<PositionFormState>(initial);
  // Tracks whether the user hand-typed a token count. Auto-split still wins
  // (it must, or Deposited and the token counts could disagree), but when it
  // overwrites hand-typed amounts we say so instead of changing them silently.
  const [tokensTouched, setTokensTouched] = useState(false);
  const [splitWarning, setSplitWarning] = useState<TokenSplitWarning | null>(
    null,
  );
  // Set when a typed deposit exceeded what this position size can be worth,
  // holding the formatted ceiling for the note.
  const [clampNote, setClampNote] = useState<string | null>(null);
  // editingStatus is only passed from the Edit call site.
  const isEditing = editingStatus !== undefined;
  // Which fields drive the rest. "price" is the existing behaviour — entry
  // price and Deposited both editable and linked. "tokens" makes the token
  // amounts the source of truth and solves the entry price from them. Add
  // only: Edit must never rewrite a recorded position from derived numbers.
  const [inputMode, setInputMode] = useState<"price" | "tokens">("price");
  // Shape of the last token-driven solve, for the explanatory note.
  const [solvedShape, setSolvedShape] = useState<
    EntryPriceFromTokens["shape"] | null
  >(null);
  const tokenMode = !isEditing && inputMode === "tokens";
  // Edit-mode correction tool. Opt-in and confirmed — the normal Entry Price
  // field keeps its protection (re-split tokens only, never touch Deposited).
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcApplied, setRecalcApplied] = useState<RecalcSummary | null>(null);
  // Exact comparison of the two stored figures (tight epsilon only to absorb
  // float representation). A balance that still equals the deposit was never
  // independently updated and is safe to move with a correction.
  const balanceTracksDeposited =
    savedDeposited !== undefined &&
    savedCurrentBalance !== undefined &&
    Math.abs(savedCurrentBalance - savedDeposited) <= 1e-8;

  const set = <K extends keyof PositionFormState>(
    key: K,
    value: PositionFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  // Writes the token counts implied by a (liquidity, entry price, range)
  // triple, flagging the case where that replaces hand-typed amounts.
  const applyTokens = (
    next: PositionFormState,
    split: TokenSplit | null,
  ): void => {
    if (!split) return;
    const baseCount = formatAmountInput(split.baseCount, 8);
    const quoteCount = formatAmountInput(split.quoteCount, 8);
    if (
      tokensTouched &&
      (baseCount !== form.token1Count || quoteCount !== form.token2Count)
    ) {
      setSplitWarning({ base: form.token1Count, quote: form.token2Count });
      setTokensTouched(false);
    }
    next.token1Count = baseCount;
    next.token2Count = quoteCount;
  };

  // Entry price and Deposited are two views of one position of a fixed size.
  // Once both are known the position's liquidity is pinned, and from then on
  // moving either one slides along the LP value curve and drags the other
  // with it — the same curve the out-of-range projections already use. Only
  // live when adding: on a saved position the recorded deposit must not move
  // just because an entry-price typo is corrected.
  const linkEntryAndDeposited = !isEditing;

  const setAnchor = (
    key: "deposited" | "entryPrice" | "bottomRange" | "topRange",
    value: string,
  ) => {
    const next: PositionFormState = { ...form, [key]: value };
    const rangeDown = num(next.bottomRange);
    const rangeUp = num(next.topRange);
    setClampNote(null);

    // Size of the position implied by what is currently on screen, before
    // this edit is folded in. Null until both numbers exist — the first pair
    // typed defines the position rather than moving it.
    const pinned = liquidityFromDeposited(
      num(form.deposited),
      num(form.entryPrice),
      num(form.bottomRange),
      num(form.topRange),
    );

    if (linkEntryAndDeposited && pinned !== null && key === "entryPrice") {
      const deposited = depositedFromLiquidity(
        pinned,
        num(value),
        rangeDown,
        rangeUp,
      );
      if (deposited !== null) {
        next.deposited = formatAmountInput(deposited, 2);
      }
    } else if (linkEntryAndDeposited && pinned !== null && key === "deposited") {
      const solved = entryPriceFromDeposited(
        num(value),
        pinned,
        rangeDown,
        rangeUp,
      );
      if (solved) {
        next.entryPrice = formatAmountInput(solved.entryPrice, 6);
        if (solved.clamped) {
          setClampNote(formatUsd(solved.maxDeposited));
          next.deposited = formatAmountInput(solved.maxDeposited, 2);
        }
      }
    }

    // Range edits keep the money fixed and re-split it (changing your range
    // is choosing a different position, not moving along one curve).
    applyTokens(
      next,
      splitDepositedIntoTokens(
        num(next.deposited),
        num(next.entryPrice),
        rangeDown,
        rangeUp,
      ),
    );
    setForm(next);
  };

  // Typing a token count directly hands control back to the user: Deposited
  // recomputes from the tokens (the original one-way flow) and auto-split
  // stops overwriting until the anchor fields move again.
  //
  // In token-amount mode the token counts are instead the source of truth:
  // the entry price is solved from them, so a position can be recorded from
  // on-chain transaction amounts rather than an estimated price.
  const setTokenCount = (
    key: "token1Count" | "token2Count",
    value: string,
  ) => {
    const next: PositionFormState = { ...form, [key]: value };

    if (inputMode === "tokens") {
      const solved = entryPriceFromTokens(
        num(next.token1Count),
        num(next.token2Count),
        num(next.bottomRange),
        num(next.topRange),
      );
      setSolvedShape(solved ? solved.shape : null);
      if (solved) {
        next.entryPrice = formatAmountInput(solved.entryPrice, 6);
      }
    }

    const computed = formDeposited(
      next.token1Count,
      next.entryPrice,
      next.token2Count,
      next.deposited,
    );
    next.deposited = computed > 0 ? formatAmountInput(computed, 2) : "";
    setTokensTouched(true);
    setSplitWarning(null);
    // Typing a token count is also how you resize past the value ceiling:
    // Deposited follows the tokens here, which re-pins the position size for
    // the next entry-price edit.
    setClampNote(null);
    setForm(next);
  };

  // Range bounds are what the entry price is solved against, so in token
  // mode moving a bound re-solves from the same token amounts.
  const setRangeBound = (
    key: "bottomRange" | "topRange",
    value: string,
  ) => {
    if (inputMode !== "tokens") {
      setAnchor(key, value);
      return;
    }
    const next: PositionFormState = { ...form, [key]: value };
    const solved = entryPriceFromTokens(
      num(next.token1Count),
      num(next.token2Count),
      num(next.bottomRange),
      num(next.topRange),
    );
    setSolvedShape(solved ? solved.shape : null);
    if (solved) {
      next.entryPrice = formatAmountInput(solved.entryPrice, 6);
    }
    const computed = formDeposited(
      next.token1Count,
      next.entryPrice,
      next.token2Count,
      next.deposited,
    );
    next.deposited = computed > 0 ? formatAmountInput(computed, 2) : "";
    setClampNote(null);
    setForm(next);
  };

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
    () =>
      tryComputeIL(
        form.entryPrice,
        form.bottomRange,
        form.topRange,
        form.token1Count,
        form.token2Count,
        form.deposited,
        "down",
      ),
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
    () =>
      tryComputeIL(
        form.entryPrice,
        form.bottomRange,
        form.topRange,
        form.token1Count,
        form.token2Count,
        form.deposited,
        "up",
      ),
    [
      form.entryPrice,
      form.bottomRange,
      form.topRange,
      form.deposited,
      form.token1Count,
      form.token2Count,
    ],
  );

  // Deposited USD stays the derived audit value even though it is now
  // typeable — setAnchor keeps the token counts consistent with whatever is
  // in the field, so this recomputation agrees with it (Invariant #9).
  const effectiveDeposited = useMemo(
    () =>
      formDeposited(
        form.token1Count,
        form.entryPrice,
        form.token2Count,
        form.deposited,
      ),
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
            <DateOrderWarning entry={form.entryDatetime} exit={exitDatetime} />
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
          {!isEditing && (
            <InputModeTabs mode={inputMode} onChange={setInputMode} />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {tokenMode ? (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Entry Price (Base)
                </span>
                <div
                  className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-sm tabular-nums text-[var(--foreground)]"
                  aria-live="polite"
                >
                  {num(form.entryPrice) > 0 ? form.entryPrice : "—"}
                </div>
                <p className="text-[11px] text-[var(--muted)]">
                  Solved from the token amounts and your range bounds.
                </p>
              </div>
            ) : (
              <Field label="Entry Price (Base)" htmlFor="entryPrice">
                <input
                  id="entryPrice"
                  type="number"
                  step="any"
                  required
                  className={inputClass}
                  value={form.entryPrice}
                  onChange={(e) => setAnchor("entryPrice", e.target.value)}
                />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Range Down" htmlFor="bottomRange">
                <input
                  id="bottomRange"
                  type="number"
                  step="any"
                  required
                  className={inputClass}
                  value={form.bottomRange}
                  onChange={(e) => setRangeBound("bottomRange", e.target.value)}
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
                  onChange={(e) => setRangeBound("topRange", e.target.value)}
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
            {tokenMode ? (
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
            ) : (
              <Field
                label="Deposited (USD)"
                htmlFor="deposited"
                hint={
                  linkEntryAndDeposited
                    ? "Linked to entry price along the LP value curve — moving either one moves the other, and the token counts follow both."
                    : "Type your deposit and the token counts split automatically — or type the token counts and this updates instead."
                }
              >
                <input
                  id="deposited"
                  type="number"
                  step="any"
                  className={inputClass}
                  placeholder="0.00"
                  value={form.deposited}
                  onChange={(e) => setAnchor("deposited", e.target.value)}
                />
              </Field>
            )}
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
                onChange={(e) => setTokenCount("token1Count", e.target.value)}
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
                onChange={(e) => setTokenCount("token2Count", e.target.value)}
              />
            </Field>
          </div>
          {isEditing && !recalcOpen && (
            <button
              type="button"
              onClick={() => {
                setRecalcApplied(null);
                setRecalcOpen(true);
              }}
              className="mt-4 rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-colors hover:border-amber-500/50 hover:text-amber-300"
            >
              Recalculate from token amounts…
            </button>
          )}
          {isEditing && recalcOpen && (
            <RecalcFromTokensPanel
              rangeDown={num(form.bottomRange)}
              rangeUp={num(form.topRange)}
              currentEntryPrice={num(form.entryPrice)}
              currentDeposited={effectiveDeposited}
              savedCurrentBalance={savedCurrentBalance ?? 0}
              balanceTracksDeposited={balanceTracksDeposited}
              baseSymbol={form.token1Symbol}
              quoteSymbol={form.token2Symbol}
              initialBase={form.token1Count}
              initialQuote={form.token2Count}
              onCancel={() => setRecalcOpen(false)}
              onApply={(entryPrice, deposited, base, quote, newBalance) => {
                setRecalcApplied({
                  fromEntry: form.entryPrice,
                  toEntry: formatAmountInput(entryPrice, 6),
                  fromDeposited: formatUsd(effectiveDeposited),
                  toDeposited: formatUsd(deposited),
                  balanceMoved: newBalance !== null,
                  staleBalance:
                    newBalance === null && savedCurrentBalance !== undefined
                      ? formatUsd(savedCurrentBalance)
                      : null,
                });
                setForm((prev) => ({
                  ...prev,
                  entryPrice: formatAmountInput(entryPrice, 6),
                  deposited: formatAmountInput(deposited, 2),
                  token1Count: base,
                  token2Count: quote,
                  currentBalanceOverride:
                    newBalance !== null ? String(newBalance) : "",
                }));
                setSplitWarning(null);
                setClampNote(null);
                setRecalcOpen(false);
              }}
            />
          )}
          {recalcApplied && (
            <p
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300"
              role="status"
            >
              Recalculated: Entry Price {recalcApplied.fromEntry} →{" "}
              {recalcApplied.toEntry}, Deposited {recalcApplied.fromDeposited} →{" "}
              {recalcApplied.toDeposited}
              {recalcApplied.balanceMoved
                ? `, Current Balance ${recalcApplied.fromDeposited} → ${recalcApplied.toDeposited}`
                : ""}
              . Save this position to record it, or close without saving to
              discard.
              {!recalcApplied.balanceMoved && recalcApplied.staleBalance && (
                <>
                  {" "}
                  Current Balance stays at {recalcApplied.staleBalance} — run
                  Update afterwards so Profit reflects reality.
                </>
              )}
            </p>
          )}
          {tokenMode && solvedShape !== null && solvedShape !== "two-sided" && (
            <p
              className="mt-3 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-300"
              role="status"
            >
              Only one token entered, so the entry price sits exactly on your{" "}
              {solvedShape === "base-only" ? "Range Down" : "Range Up"} bound —
              that is where a position holds{" "}
              {solvedShape === "base-only"
                ? `only ${form.token1Symbol || "the base token"}`
                : `only ${form.token2Symbol || "the quote token"}`}
              . Enter both amounts to solve a price inside the range.
            </p>
          )}
          {tokenMode && form.token1Count !== "" && form.token2Count !== "" &&
            solvedShape === null && (
            <p
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300"
              role="status"
            >
              Could not solve an entry price from these amounts. Check that both
              range bounds are set and Range Up is above Range Down.
            </p>
          )}
          {clampNote && (
            <p
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300"
              role="status"
            >
              At this position size the deposit tops out at {clampNote} — above
              the top of your range the position is all{" "}
              {form.token2Symbol || "quote token"}, so its value stops rising.
              Change a token count to size the position differently.
            </p>
          )}
          {splitWarning && (
            <p
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300"
              role="status"
            >
              Auto-split replaced your typed token counts (
              {splitWarning.base || "0"} {form.token1Symbol || "base"} /{" "}
              {splitWarning.quote || "0"} {form.token2Symbol || "quote"}). Edit
              a token count again to take back control.
            </p>
          )}
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
            <DateOrderWarning
              entry={position.entryDatetime}
              exit={exitDatetime}
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
