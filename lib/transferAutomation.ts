import { isStableSymbol } from "./calculations";
import { getTransfers, saveTransfers } from "./storage";
import type { FeeClaim, Position, Transfer } from "./types";

// Notes stamped on auto-created transfers. Also a tell-tale: an auto transfer
// still carrying its stamp and no other user edits is "untouched" and safe to
// rebuild; anything else the user has claimed as their own.
export const AUTO_CLAIM_NOTE = "AUTO-CREATED FROM FEE CLAIM";
export const AUTO_CLOSE_NOTE = "AUTO-CREATED FROM ABOVE-RANGE CLOSE";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function dayOf(date: string): string {
  return (date ?? "").slice(0, 10);
}

// A transfer the automation made and the user has not since edited. platform,
// destination and moneyStatus are all left in their auto state (blank / blank
// / unset), and the auto note is intact. If any of those changed, the user has
// taken ownership of the row and we must not overwrite it.
export function isUntouchedAuto(t: Transfer): boolean {
  const stamp = t.sourceClaimId ? AUTO_CLAIM_NOTE : AUTO_CLOSE_NOTE;
  return (
    t.platform === "" &&
    t.destination === "" &&
    t.moneyStatus === undefined &&
    t.notes === stamp
  );
}

interface ClaimSide {
  symbol: string;
  amount: number;
}

function rewardSides(claim: FeeClaim): ClaimSide[] {
  return [
    { symbol: claim.token1Symbol.trim().toUpperCase(), amount: claim.token1Amount },
    { symbol: claim.token2Symbol.trim().toUpperCase(), amount: claim.token2Amount },
  ].filter((s) => s.symbol !== "" && Number.isFinite(s.amount) && s.amount > 0);
}

// The non-stable reward legs of a claim, i.e. the price-exposed tokens. Two of
// these (e.g. ETH + BTC) is the dual-token case that needs a historical split.
export function nonStableRewardSymbols(claim: FeeClaim): string[] {
  return rewardSides(claim)
    .filter((s) => !isStableSymbol(s.symbol))
    .map((s) => s.symbol);
}

function autoClaimTransfer(
  claim: FeeClaim,
  token: string,
  amount: number,
): Transfer {
  return {
    id: newId(),
    positionId: claim.positionId,
    date: dayOf(claim.date),
    token,
    amount,
    platform: "",
    destination: "",
    transferType: "fees",
    // moneyStatus deliberately omitted -> "needs review" (never guessed as
    // redeployed): this money has not been moved or spent yet at claim time.
    sourceClaimId: claim.id,
    notes: AUTO_CLAIM_NOTE,
  };
}

export interface BuiltClaimTransfers {
  transfers: Transfer[];
  // True when the claim has two non-stable legs but no prices were supplied,
  // so the caller must fetch historical prices and build again.
  needsPrices: boolean;
  dualSymbols: string[];
}

// Transfers a fee claim should produce. One record for a single reward leg
// (± a stablecoin side); two records split by real historical value for a
// two-non-stable-token claim. Amounts are the claim's USD value (stableAmount),
// so they sum back to it exactly.
export function buildClaimTransfers(
  claim: FeeClaim,
  prices?: Record<string, number>,
): BuiltClaimTransfers {
  const usd = Number.isFinite(claim.stableAmount ?? NaN)
    ? (claim.stableAmount as number)
    : 0;
  const sides = rewardSides(claim);
  const nonStable = sides.filter((s) => !isStableSymbol(s.symbol));

  // Two price-exposed legs: split the USD value by each leg's real historical
  // worth on the claim date (amount x price), not by raw token count.
  if (nonStable.length >= 2) {
    const dualSymbols = nonStable.slice(0, 2).map((s) => s.symbol);
    if (!prices) {
      return { transfers: [], needsPrices: true, dualSymbols };
    }
    const [a, b] = nonStable;
    const va = a.amount * (prices[a.symbol] ?? NaN);
    const vb = b.amount * (prices[b.symbol] ?? NaN);
    if (Number.isFinite(va) && Number.isFinite(vb) && va + vb > 0) {
      const amountA = (usd * va) / (va + vb);
      // Second leg is the remainder so the two always sum to usd exactly.
      const amountB = usd - amountA;
      return {
        transfers: [
          autoClaimTransfer(claim, a.symbol, amountA),
          autoClaimTransfer(claim, b.symbol, amountB),
        ],
        needsPrices: false,
        dualSymbols,
      };
    }
    // Prices came back unusable: fall back to a single combined record rather
    // than inventing a split, so the money still reconciles and is reviewable.
    return {
      transfers: [autoClaimTransfer(claim, a.symbol, usd)],
      needsPrices: false,
      dualSymbols,
    };
  }

  // Single reward leg (or an all-stable claim): one record. Prefer the
  // non-stable symbol; else the cashed-out stable symbol; else whatever leg.
  const token =
    nonStable[0]?.symbol ??
    (claim.stableSymbol ?? "").trim().toUpperCase() ??
    sides[0]?.symbol ??
    "";
  return {
    transfers: [autoClaimTransfer(claim, token || "—", usd)],
    needsPrices: false,
    dualSymbols: [],
  };
}

async function fetchClaimDayPrices(
  claim: FeeClaim,
  symbols: string[],
): Promise<Record<string, number> | null> {
  const ts = Math.floor(
    new Date(`${dayOf(claim.date)}T12:00:00Z`).getTime() / 1000,
  );
  if (!Number.isFinite(ts) || ts <= 0) return null;
  try {
    const res = await fetch(
      `/api/prices/historical?symbols=${encodeURIComponent(
        symbols.join(","),
      )}&timestamp=${ts}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { prices?: Record<string, number> };
    return data.prices ?? {};
  } catch {
    return null;
  }
}

export type ReconcileResult =
  | { status: "created"; count: number }
  | { status: "updated"; count: number }
  | { status: "skipped-touched" }
  | { status: "skipped-existing" }
  | { status: "noop" };

// Creates (or, for an untouched auto row, rebuilds) the transfers a claim
// should have. If the user has edited the auto transfer, it is left exactly as
// they left it and the claim is reported as skipped so nothing silently
// diverges. Safe to call on both new and edited claims — it keys strictly off
// sourceClaimId, never the day+position heuristic.
export async function reconcileClaimTransfers(
  claim: FeeClaim,
): Promise<ReconcileResult> {
  const all = getTransfers();
  const own = all.filter((t) => t.sourceClaimId === claim.id);

  if (own.length > 0) {
    // The claim already has an auto transfer. If the user has edited it, leave
    // it exactly as they left it and report skipped so nothing diverges.
    if (!own.every(isUntouchedAuto)) return { status: "skipped-touched" };
  } else if (
    // No auto transfer yet, but a manual (or other) fee transfer already
    // covers this claim's position+day — don't duplicate it. This is what
    // makes editing a legacy claim safe: it won't manufacture a second row
    // beside a hand-logged one.
    all.some(
      (t) =>
        t.transferType === "fees" &&
        t.positionId === claim.positionId &&
        dayOf(t.date) === dayOf(claim.date),
    )
  ) {
    return { status: "skipped-existing" };
  }

  const existing = own;
  let built = buildClaimTransfers(claim);
  if (built.needsPrices) {
    const prices = await fetchClaimDayPrices(claim, built.dualSymbols);
    built = buildClaimTransfers(claim, prices ?? {});
  }
  if (built.transfers.length === 0) return { status: "noop" };

  const withoutOld = all.filter((t) => t.sourceClaimId !== claim.id);
  saveTransfers([...withoutOld, ...built.transfers]);
  return {
    status: existing.length > 0 ? "updated" : "created",
    count: built.transfers.length,
  };
}

// ── Above-range close → Out-of-Range-Upside transfer ────────────────────────

export function buildUpsideTransfer(position: Position): Transfer | null {
  const scalp = position.scalp ?? 0;
  if (!Number.isFinite(scalp) || scalp <= 0) return null;
  return {
    id: newId(),
    positionId: position.id,
    date: dayOf(position.exitDatetime ?? ""),
    token: position.token2Symbol.trim().toUpperCase() || position.pair,
    amount: scalp,
    platform: "",
    destination: "",
    transferType: "outOfRangeUpside",
    sourceCloseId: position.id,
    notes: AUTO_CLOSE_NOTE,
  };
}

// Idempotent: creates the upside transfer only if this close does not already
// have one (by sourceCloseId). Returns whether it created a record.
export function createUpsideTransfer(position: Position): boolean {
  const all = getTransfers();
  if (all.some((t) => t.sourceCloseId === position.id)) return false;
  const transfer = buildUpsideTransfer(position);
  if (!transfer) return false;
  saveTransfers([...all, transfer]);
  return true;
}

// ── Backfill eligibility (pure) ─────────────────────────────────────────────

// A claim already has a fee transfer if an auto row points at it, OR a
// manual row lands on the same position and calendar day tagged "fees" — the
// safe heuristic from Phase A that avoids duplicating a hand-logged transfer.
export function claimHasFeeTransfer(
  claim: FeeClaim,
  transfers: Transfer[],
): boolean {
  return transfers.some(
    (t) =>
      t.sourceClaimId === claim.id ||
      (t.transferType === "fees" &&
        t.positionId === claim.positionId &&
        dayOf(t.date) === dayOf(claim.date)),
  );
}

export function eligibleClaimsForBackfill(
  claims: FeeClaim[],
  transfers: Transfer[],
): FeeClaim[] {
  return claims.filter((c) => !claimHasFeeTransfer(c, transfers));
}

// Upside exits cannot be detected from stored data (Phase A), so eligibility
// only narrows the list to closed, profitable positions the user must confirm;
// it never presumes the exit was above range.
export function closeHasUpsideTransfer(
  position: Position,
  transfers: Transfer[],
): boolean {
  return transfers.some(
    (t) =>
      t.sourceCloseId === position.id ||
      (t.transferType === "outOfRangeUpside" && t.positionId === position.id),
  );
}

export function eligibleClosesForBackfill(
  positions: Position[],
  transfers: Transfer[],
): Position[] {
  return positions.filter(
    (p) =>
      p.status === "closed" &&
      Number.isFinite(p.scalp ?? NaN) &&
      (p.scalp as number) > 0 &&
      !closeHasUpsideTransfer(p, transfers),
  );
}
