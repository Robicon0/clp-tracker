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

// Local calendar day (YYYY-MM-DD) of a full datetime. A closed position stores
// exitDatetime as a UTC ISO string, but the Positions page shows it in local
// time (formatDateTime24). Slicing the UTC portion would put the transfer on a
// different day than the position for any close whose local and UTC dates
// differ (e.g. a morning close in UTC+10). Deriving the local day keeps the
// two in agreement (Invariant #2 timezone note). A bare "YYYY-MM-DD" (the
// manual/claim date format, no time) round-trips unchanged.
function localDayOf(datetime: string): string {
  const s = datetime ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A transfer the automation made and the user has not since edited. platform,
// destination and moneyStatus are all left in their auto state (blank / blank
// / unset), and the auto note is intact. If any of those changed, the user has
// taken ownership of the row and we must not overwrite it.
export function isUntouchedAuto(t: Transfer): boolean {
  const stamp = t.sourceClaimId ? AUTO_CLAIM_NOTE : AUTO_CLOSE_NOTE;
  // moneyStatus is now written "redeployed" at creation (the "Needs Review"
  // state was retired); undefined is still accepted for legacy auto rows made
  // before that change. A deploy-link means the user took ownership — never
  // rebuild over it.
  return (
    t.platform === "" &&
    t.destination === "" &&
    (t.moneyStatus === undefined || t.moneyStatus === "redeployed") &&
    t.deployedToPositionId === undefined &&
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
    // Redeployed by default (the "Needs Review" state was retired): fee money
    // stays in the business until the user marks it deployed or an expense.
    moneyStatus: "redeployed",
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
    // No auto transfer yet, but a MANUAL fee transfer already covers this
    // claim's position+day — don't duplicate a hand-logged row. Restricted to
    // manual transfers (no sourceClaimId): auto transfers are deduped
    // precisely by sourceClaimId, so an auto row for a *different* claim on the
    // same position+day must NOT block this one — that false match dropped
    // legitimate same-day claims during backfill.
    all.some(
      (t) =>
        t.transferType === "fees" &&
        t.sourceClaimId === undefined &&
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
    date: localDayOf(position.exitDatetime ?? ""),
    token: position.token2Symbol.trim().toUpperCase() || position.pair,
    amount: scalp,
    platform: "",
    destination: "",
    transferType: "outOfRangeUpside",
    // Redeployed by default (Needs Review retired).
    moneyStatus: "redeployed",
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

// ── Revert to auto-created ──────────────────────────────────────────────────

// Only a transfer the automation made has an "auto-created" state to go back
// to. Manually-logged rows (Undeployed Tokens, hand-entered fees, expenses)
// carry neither source id and must never offer the action.
export function isAutoCreated(t: Transfer): boolean {
  return t.sourceClaimId !== undefined || t.sourceCloseId !== undefined;
}

export interface AutoRevertPlan {
  source: "claim" | "close";
  // The stored records that will be replaced — the WHOLE source group, because
  // a dual-token claim produces two legs whose amounts are computed against
  // each other. Reverting one leg alone could not reproduce the split.
  current: Transfer[];
  // What the automation produces from the linked claim/close as it stands now.
  // Ids are carried over from `current` in order, so a revert edits records in
  // place instead of minting new ones.
  next: Transfer[];
  // Set when the plan cannot be built; `next` is empty and nothing may apply.
  error?: string;
}

function alignIds(built: Transfer[], existing: Transfer[]): Transfer[] {
  return built.map((t, i) =>
    existing[i] ? { ...t, id: existing[i].id } : t,
  );
}

// Recomputes what the automation WOULD produce right now from the linked
// claim/close's current stored data — deliberately a recomputation, not a
// stored snapshot, so it works on every auto transfer ever created with no
// migration. Runs the same buildClaimTransfers / buildUpsideTransfer the
// automation itself uses (including the dual-token historical price split), so
// there is no second copy of this logic to drift.
export async function planRevertToAuto(
  transfer: Transfer,
  claims: FeeClaim[],
  positions: Position[],
): Promise<AutoRevertPlan> {
  const all = getTransfers();

  if (transfer.sourceClaimId !== undefined) {
    const current = all.filter((t) => t.sourceClaimId === transfer.sourceClaimId);
    const claim = claims.find((c) => c.id === transfer.sourceClaimId);
    if (!claim) {
      return {
        source: "claim",
        current,
        next: [],
        error:
          "The fee claim this transfer was created from no longer exists, so there is nothing to recompute from.",
      };
    }
    let built = buildClaimTransfers(claim);
    if (built.needsPrices) {
      const prices = await fetchClaimDayPrices(claim, built.dualSymbols);
      built = buildClaimTransfers(claim, prices ?? {});
    }
    if (built.transfers.length === 0) {
      return {
        source: "claim",
        current,
        next: [],
        error: "This claim no longer produces a transfer.",
      };
    }
    return { source: "claim", current, next: alignIds(built.transfers, current) };
  }

  const current = all.filter((t) => t.sourceCloseId === transfer.sourceCloseId);
  const position = positions.find((p) => p.id === transfer.sourceCloseId);
  if (!position) {
    return {
      source: "close",
      current,
      next: [],
      error:
        "The closed position this transfer was created from no longer exists, so there is nothing to recompute from.",
    };
  }
  const built = buildUpsideTransfer(position);
  if (!built) {
    return {
      source: "close",
      current,
      next: [],
      error:
        "This position's Scalp is no longer positive, so the automation would not create an upside transfer for it now.",
    };
  }
  return { source: "close", current, next: alignIds([built], current) };
}

// Applies a plan: the source group is replaced wholesale by the rebuilt set.
// Every manual edit on those records — platform, destination, money status,
// deploy-link, notes, amount — is discarded, which is the point of the action.
export function applyRevertToAuto(plan: AutoRevertPlan): void {
  if (plan.next.length === 0) return;
  const replaced = new Set(plan.current.map((t) => t.id));
  saveTransfers([
    ...getTransfers().filter((t) => !replaced.has(t.id)),
    ...plan.next,
  ]);
}

// ── Backfill eligibility (pure) ─────────────────────────────────────────────

// A claim already has a fee transfer if an auto row points at it (by
// sourceClaimId), OR a MANUAL row lands on the same position and calendar day
// tagged "fees" — the safe heuristic from Phase A that avoids duplicating a
// hand-logged transfer. The manual restriction matters: two legitimate fee
// claims on one position on one day would otherwise falsely mark the second as
// covered by the first's auto transfer and drop it from the backfill.
export function claimHasFeeTransfer(
  claim: FeeClaim,
  transfers: Transfer[],
): boolean {
  return transfers.some(
    (t) =>
      t.sourceClaimId === claim.id ||
      (t.transferType === "fees" &&
        t.sourceClaimId === undefined &&
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
