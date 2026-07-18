import type { FeeClaim, PortfolioSummary, Position } from "./types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function toFinite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function calcDaysActive(
  entryDatetime: string,
  exitDatetime?: string | null,
): number {
  const entry = new Date(entryDatetime).getTime();
  if (Number.isNaN(entry)) return 0;

  const endRaw = exitDatetime ? new Date(exitDatetime).getTime() : Date.now();
  const end = Number.isNaN(endRaw) ? Date.now() : endRaw;

  const diff = (end - entry) / MS_PER_DAY;
  return diff > 0 ? diff : 0;
}

export function calcTotalFees(claimed: number, newFees: number): number {
  return toFinite(claimed) + toFinite(newFees);
}

export function calcPriceDiff(currentBalance: number, deposited: number): number {
  return toFinite(currentBalance) - toFinite(deposited);
}

export function calcProfit(priceDiff: number, fees: number): number {
  return toFinite(priceDiff) + toFinite(fees);
}

export function calcClosedProfit(
  scalp: number | null,
  fees: number,
): number {
  return toFinite(scalp) + toFinite(fees);
}

// Branches on status: closed positions realize profit from Scalp + Fees,
// active positions from Price Diff + Fees. Single source of truth so every
// surface (Dashboard, Positions, Total P&L) agrees (Invariant #6).
export function calcPositionProfit(
  position: Position,
  totalFees: number,
  priceDiff: number,
): number {
  if (position.status === "closed") {
    return calcClosedProfit(position.scalp, totalFees);
  }
  return calcProfit(priceDiff, totalFees);
}

export function calcFeeAPR(
  fees: number,
  deposited: number,
  daysActive: number,
): number {
  if (deposited <= 0 || daysActive <= 0) return 0;
  return (fees / deposited) * (365 / daysActive) * 100;
}

export function calcDailyAPR(feeAPR: number): number {
  return toFinite(feeAPR) / 365;
}

export function calcMonthlyAPR(feeAPR: number): number {
  return toFinite(feeAPR) / 12;
}

export function calcYearlyAPR(
  fees: number,
  daysActive: number,
  deposited: number,
): number {
  return calcFeeAPR(fees, deposited, daysActive);
}

export function calcROI(profit: number, deposited: number): number {
  if (deposited <= 0) return 0;
  return (profit / deposited) * 100;
}

export function calcADF(fees: number, daysActive: number): number {
  if (daysActive <= 0) return 0;
  return fees / daysActive;
}

export interface ILResult {
  lowerPrice: number;
  upperPrice: number;
  currentRatio: number;
  futureRatio: number;
  inRange: boolean;
  initialToken0: number;
  initialToken1: number;
  futureToken0: number;
  futureToken1: number;
  hodlValue: number;
  lpValue: number;
  lpWithYield: number;
  yieldEarned: number;
  ilDollar: number;
  ilPercent: number;
  hodlPct: number;
  lpPct: number;
  daysToCover: number;
  apr: number;
  yieldPct: number;
}

export function calcIL(
  p0: number,
  p1: number,
  f0: number,
  f1: number,
  inv: number,
  lowerPct: number,
  upperPct: number,
  dailyYield: number,
  days: number,
  token0Count?: number,
  token1Count?: number,
): ILResult {
  const cr = p0 / p1;
  const fr = f0 / f1;
  const lp = cr * (1 + lowerPct / 100);
  const up = cr * (1 + upperPct / 100);
  const inR = fr >= lp && fr <= up;
  const spa = Math.sqrt(lp);
  const spb = Math.sqrt(up);
  const sp0 = Math.sqrt(cr);
  const sp1 = Math.sqrt(fr);
  // Initial amounts per unit of liquidity branch on where the entry
  // price sits relative to the range: at/below the bottom the position
  // is 100% token0, at/above the top it is 100% token1.
  let t0pL: number;
  let t1pL: number;
  if (cr <= lp) {
    t0pL = 1 / spa - 1 / spb;
    t1pL = 0;
  } else if (cr >= up) {
    t0pL = 0;
    t1pL = spb - spa;
  } else {
    t0pL = 1 / sp0 - 1 / spb;
    t1pL = sp0 - spa;
  }
  const vpL = t0pL * cr + t1pL;
  // Liquidity from actual token amounts when available — Deposited USD
  // may be valued at a different price than entryPrice (DEX interfaces
  // report live market value), which would skew L by the mismatch ratio.
  const t0 = toFinite(token0Count);
  const t1 = toFinite(token1Count);
  let L: number;
  if (t0 > 0 && t1 > 0 && t0pL > 0 && t1pL > 0) {
    // Case 1 — two-sided position with entry price inside the range.
    // Solve for L using BOTH token amounts simultaneously (quadratic
    // method), removing the single-side entry-price sensitivity that
    // amplified out-of-range projections when Deposited USD / entry
    // price drifted from the actual on-chain valuation.
    //   A·L² − B·L − C = 0, positive root only.
    const A = 1 - spa / spb;
    const B = t0 * spa + t1 / spb;
    const C = t0 * t1;
    L = A > 0 ? (B + Math.sqrt(B * B + 4 * A * C)) / (2 * A) : 0;
  } else if (t1 > 0 && t1pL > 0) {
    // Case 2 — single-sided (quote only) or entry outside range.
    L = t1 / t1pL;
  } else if (t0 > 0 && t0pL > 0) {
    // Case 2 — single-sided (base only) or entry outside range.
    L = t0 / t0pL;
  } else {
    // Case 3 — legacy records with no token counts: value-based fallback.
    L = vpL > 0 ? inv / vpL : 0;
  }
  const it0 = L * t0pL;
  const it1 = L * t1pL;
  let ft0: number;
  let ft1: number;
  if (fr <= lp) {
    ft0 = L * (1 / spa - 1 / spb);
    ft1 = 0;
  } else if (fr >= up) {
    ft0 = 0;
    ft1 = L * (spb - spa);
  } else {
    ft0 = L * (1 / sp1 - 1 / spb);
    ft1 = L * (sp1 - spa);
  }
  const hv0 = it0 * f0;
  const hv1 = it1 * f1;
  const hodl = hv0 + hv1;
  const fv0 = ft0 * f0;
  const fv1 = ft1 * f1;
  const lpValue = fv0 + fv1;
  const apr = dailyYield * 365;
  const yieldPct = dailyYield * days;
  const yieldEarned = inv * (yieldPct / 100);
  const lpWithYield = lpValue + yieldEarned;
  const ilDollar = lpValue - hodl;
  const ilPercent = hodl > 0 ? (ilDollar / hodl) * 100 : 0;
  const dailyYieldDollar = (apr / 100 / 365) * inv;
  const daysToCover =
    dailyYieldDollar > 0 ? Math.abs(ilDollar) / dailyYieldDollar : 99999;
  const hodlPct = inv > 0 ? ((hodl - inv) / inv) * 100 : 0;
  const lpPct = inv > 0 ? ((lpWithYield - inv) / inv) * 100 : 0;
  return {
    lowerPrice: lp,
    upperPrice: up,
    currentRatio: cr,
    futureRatio: fr,
    inRange: inR,
    initialToken0: it0,
    initialToken1: it1,
    futureToken0: ft0,
    futureToken1: ft1,
    hodlValue: hodl,
    lpValue,
    lpWithYield,
    yieldEarned,
    ilDollar,
    ilPercent,
    hodlPct,
    lpPct,
    daysToCover,
    apr,
    yieldPct,
  };
}

export interface ILInput {
  entryPrice: number;
  rangeDown: number;
  rangeUp: number;
  deposited: number;
  token0Count?: number;
  token1Count?: number;
}

// Single source of truth for out-of-range projections — every surface
// (position form, Pool P&L) must go through this wrapper (Invariant #6).
export function computePositionIL(
  input: ILInput,
  futurePrice: number,
): ILResult | null {
  const { entryPrice, rangeDown, rangeUp, deposited, token0Count, token1Count } =
    input;
  if (
    ![entryPrice, rangeDown, rangeUp, deposited, futurePrice].every(
      Number.isFinite,
    ) ||
    entryPrice <= 0 ||
    rangeDown <= 0 ||
    rangeUp <= 0 ||
    deposited <= 0 ||
    futurePrice <= 0 ||
    rangeUp <= rangeDown
  ) {
    return null;
  }
  const lowerPct = ((rangeDown - entryPrice) / entryPrice) * 100;
  const upperPct = ((rangeUp - entryPrice) / entryPrice) * 100;
  return calcIL(
    entryPrice,
    1,
    futurePrice,
    1,
    deposited,
    lowerPct,
    upperPct,
    0,
    0,
    token0Count,
    token1Count,
  );
}

// position.claimed is a derived value, not a user input (Invariant #10):
// the sum of stableAmount across ALL claims linked to the position —
// stableAmount means "USD value of the claim" regardless of conversion
// status (Sprint 5). Legacy claims saved without a USD value hold null and
// contribute $0 until claim-time historical pricing lands (Sprint 8 /
// Invariant #2). Falls back to the stored value only for positions with no
// valued claims logged.
export function getEffectiveClaimed(
  position: Position,
  allClaims: FeeClaim[],
): number {
  const relatedClaims = allClaims.filter(
    (c) => c.positionId === position.id && c.stableAmount !== null,
  );
  if (relatedClaims.length > 0) {
    return relatedClaims.reduce((sum, c) => sum + toFinite(c.stableAmount), 0);
  }
  return toFinite(position.claimed);
}

// newFees (unclaimed accrued fees) stays manual by definition — those fees
// don't exist as claim records yet. Only claimed is derived.
export function getEffectiveTotalFees(
  position: Position,
  allClaims: FeeClaim[],
): number {
  return getEffectiveClaimed(position, allClaims) + toFinite(position.newFees);
}

// Deposited USD is a derived value, not a user input (Invariant #9):
// (base token count × entry price) + quote token count, quote being a $1
// stablecoin by convention. Every calculation or display that reads
// position.deposited must go through this helper so legacy records with a
// mistyped stored value display corrected numbers. Falls back to the
// stored value only when token counts are missing/zero.
export function getEffectiveDeposited(position: Position): number {
  const base = toFinite(position.token1Count);
  const entry = toFinite(position.entryPrice);
  const quote = toFinite(position.token2Count);
  const computed =
    (base > 0 && entry > 0 ? base * entry : 0) + (quote > 0 ? quote : 0);
  if (computed > 0) return computed;
  return toFinite(position.deposited);
}

export interface TokenPnLRow {
  token: string;
  activeCount: number;
  closedCount: number;
  unrealized: number;
  realized: number;
  shortPnl: number;
  fees: number;
  netPnl: number;
}

// Sprint 6: per-token P&L books, mirroring the Google Sheet's Pool P&L 0
// tab. Positions group by base token symbol (token1Symbol). Realized =
// closed positions' (final balance − deposited); Unrealized = active
// positions' (current balance − deposited); Short P&L sums shortTotal.
// Net = realized + unrealized + short. Fee income is informational only
// and stays OUT of netPnl — the sheet keeps fees out of the token books
// (per-token fee income lives in Total P&L's Fee Income Breakdown).
export function calcTokenPnL(
  positions: Position[],
  allClaims: FeeClaim[],
): TokenPnLRow[] {
  const map = new Map<string, TokenPnLRow>();
  for (const p of positions) {
    const token = (p.token1Symbol || "").trim().toUpperCase() || "—";
    let row = map.get(token);
    if (!row) {
      row = {
        token,
        activeCount: 0,
        closedCount: 0,
        unrealized: 0,
        realized: 0,
        shortPnl: 0,
        fees: 0,
        netPnl: 0,
      };
      map.set(token, row);
    }
    const principalDiff = toFinite(p.currentBalance) - getEffectiveDeposited(p);
    if (p.status === "closed") {
      row.closedCount += 1;
      row.realized += principalDiff;
    } else {
      row.activeCount += 1;
      row.unrealized += principalDiff;
    }
    if (p.shortTotal !== null && Number.isFinite(p.shortTotal)) {
      row.shortPnl += p.shortTotal;
    }
    row.fees += getEffectiveTotalFees(p, allClaims);
  }
  const rows = Array.from(map.values());
  for (const row of rows) {
    row.netPnl = row.realized + row.unrealized + row.shortPnl;
  }
  rows.sort((a, b) => b.netPnl - a.netPnl);
  return rows;
}

// Business P&L (mirrors the Business P&L sheet): lifetime reward-token
// quantities from claim records, valued at user-entered current prices.
// "Usdc Converted" is the claim-time USD value (stableAmount); the sheet's
// P&L is the gap between claim-time value and today's value if held in kind.
export interface BusinessTokenRow {
  token: string;
  quantity: number;
  price: number | null;
  usdValue: number | null;
}

export interface BusinessPnL {
  tokenRows: BusinessTokenRow[];
  allTotal: number;
  unpricedTokens: string[];
  usdcConverted: number;
  pnl: number;
}

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USD"]);

export function calcBusinessPnL(
  claims: FeeClaim[],
  prices: Record<string, number>,
): BusinessPnL {
  const quantities = new Map<string, number>();
  let usdcConverted = 0;

  const add = (symbol: string, amount: number) => {
    const token = symbol.trim().toUpperCase();
    if (token === "" || !Number.isFinite(amount) || amount === 0) return;
    quantities.set(token, (quantities.get(token) ?? 0) + amount);
  };

  for (const claim of claims) {
    add(claim.token1Symbol, claim.token1Amount);
    add(claim.token2Symbol, claim.token2Amount);
    if (claim.stableAmount !== null && Number.isFinite(claim.stableAmount)) {
      usdcConverted += claim.stableAmount;
    }
  }

  const tokenRows: BusinessTokenRow[] = [];
  const unpricedTokens: string[] = [];
  let allTotal = 0;

  for (const [token, quantity] of quantities) {
    let price: number | null = Number.isFinite(prices[token])
      ? prices[token]
      : null;
    if (price === null && STABLE_SYMBOLS.has(token)) price = 1;
    const usdValue = price === null ? null : quantity * price;
    if (usdValue === null) unpricedTokens.push(token);
    else allTotal += usdValue;
    tokenRows.push({ token, quantity, price, usdValue });
  }

  tokenRows.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
  return {
    tokenRows,
    allTotal,
    unpricedTokens,
    usdcConverted,
    pnl: usdcConverted - allTotal,
  };
}

// Yield accumulated strictly after a checkpoint date — the sheet's
// "Accumulate the yield after <date>" rows, derived instead of hardcoded.
export function calcYieldAfter(claims: FeeClaim[], dateIso: string): number {
  const cutoff = new Date(dateIso).getTime();
  if (!Number.isFinite(cutoff)) return 0;
  let total = 0;
  for (const claim of claims) {
    if (claim.stableAmount === null || !Number.isFinite(claim.stableAmount)) {
      continue;
    }
    const t = new Date(claim.date).getTime();
    if (Number.isFinite(t) && t > cutoff) total += claim.stableAmount;
  }
  return total;
}

// Unconverted holdings: reward tokens from claims NOT cashed out to stable
// (the sheet's "Still in X" rows). Only these are still price-exposed; a
// converted claim's tokens were already sold. Cost basis per claim side:
// stablecoin sides count at face value, and the remaining stableAmount is
// attributed to the volatile side(s). Claims with no stableAmount have
// unknown cost basis and are flagged (excluded from cost basis / P&L only).
export interface HoldingRow {
  token: string;
  quantity: number;
  price: number | null;
  currentValue: number | null;
  costBasis: number | null;
  pnl: number | null;
}

export interface UnconvertedHoldings {
  rows: HoldingRow[];
  totalCurrentValue: number;
  totalCostBasis: number;
  totalPnl: number;
  unpricedTokens: string[];
  hasUnknownCostBasis: boolean;
}

export function calcUnconvertedHoldings(
  claims: FeeClaim[],
  prices: Record<string, number>,
): UnconvertedHoldings {
  const quantities = new Map<string, number>();
  const costBasis = new Map<string, number>();
  // Tokens where at least one contributing claim lacks a claim-time value.
  // Their cost basis is only partial, so we refuse to show a P&L for them
  // rather than report a misleadingly inflated gain (North Star: auditable).
  const unknownBasisTokens = new Set<string>();
  let hasUnknownCostBasis = false;

  const addQty = (symbol: string, amount: number): string | null => {
    const token = symbol.trim().toUpperCase();
    if (token === "" || !Number.isFinite(amount) || amount === 0) return null;
    quantities.set(token, (quantities.get(token) ?? 0) + amount);
    return token;
  };

  const addCost = (token: string, value: number) => {
    if (!Number.isFinite(value)) return;
    costBasis.set(token, (costBasis.get(token) ?? 0) + value);
  };

  for (const claim of claims) {
    if (claim.convertedToStable) continue;

    // Collect this claim's held sides (token + amount), skipping empties.
    const sides: Array<{ token: string; amount: number }> = [];
    const t1 = addQty(claim.token1Symbol, claim.token1Amount);
    if (t1) sides.push({ token: t1, amount: claim.token1Amount });
    const t2 = addQty(claim.token2Symbol, claim.token2Amount);
    if (t2) sides.push({ token: t2, amount: claim.token2Amount });
    if (sides.length === 0) continue;

    // Cost basis needs the claim-time USD value; without it, mark every side
    // as unknown-basis and flag globally.
    if (claim.stableAmount === null || !Number.isFinite(claim.stableAmount)) {
      hasUnknownCostBasis = true;
      for (const s of sides) unknownBasisTokens.add(s.token);
      continue;
    }

    // Stable sides count at face value; volatile side(s) split the remainder.
    const stableSides = sides.filter((s) => STABLE_SYMBOLS.has(s.token));
    const volatileSides = sides.filter((s) => !STABLE_SYMBOLS.has(s.token));
    let stableFace = 0;
    for (const s of stableSides) {
      addCost(s.token, s.amount);
      stableFace += s.amount;
    }
    const residual = claim.stableAmount - stableFace;
    if (volatileSides.length === 0) continue;
    if (volatileSides.length === 1) {
      addCost(volatileSides[0].token, residual);
    } else {
      // Rare multi-volatile claim: split residual by current price weight,
      // falling back to equal split when prices are missing.
      let weightTotal = 0;
      const weights = volatileSides.map((s) => {
        const p = Number.isFinite(prices[s.token]) ? prices[s.token] : 0;
        const w = p > 0 ? s.amount * p : 0;
        weightTotal += w;
        return w;
      });
      volatileSides.forEach((s, i) => {
        const share =
          weightTotal > 0 ? weights[i] / weightTotal : 1 / volatileSides.length;
        addCost(s.token, residual * share);
      });
    }
  }

  const rows: HoldingRow[] = [];
  const unpricedTokens: string[] = [];
  let totalCurrentValue = 0;
  let totalCostBasis = 0;
  let totalPnl = 0;

  for (const [token, quantity] of quantities) {
    let price: number | null = Number.isFinite(prices[token])
      ? prices[token]
      : null;
    if (price === null && STABLE_SYMBOLS.has(token)) price = 1;
    const currentValue = price === null ? null : quantity * price;
    // A token with any unknown-basis contribution has no trustworthy cost
    // basis or P&L — show "—" instead of a partial (inflated) figure.
    const basis =
      unknownBasisTokens.has(token) || !costBasis.has(token)
        ? null
        : (costBasis.get(token) as number);
    const pnl =
      currentValue === null || basis === null ? null : currentValue - basis;

    if (currentValue === null) unpricedTokens.push(token);
    else totalCurrentValue += currentValue;
    if (basis !== null) totalCostBasis += basis;
    if (pnl !== null) totalPnl += pnl;

    rows.push({ token, quantity, price, currentValue, costBasis: basis, pnl });
  }

  rows.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));
  return {
    rows,
    totalCurrentValue,
    totalCostBasis,
    totalPnl,
    unpricedTokens,
    hasUnknownCostBasis,
  };
}

export function calcWideRangePercent(
  rangeDown: number,
  rangeUp: number,
): number {
  if (
    rangeDown <= 0 ||
    !Number.isFinite(rangeDown) ||
    !Number.isFinite(rangeUp)
  ) {
    return 0;
  }
  return ((rangeUp - rangeDown) / rangeDown) * 100;
}

export function calcPortfolioSummary(
  positions: Position[],
  allClaims: FeeClaim[] = [],
): PortfolioSummary {
  const summary: PortfolioSummary = {
    totalDeposited: 0,
    totalCurrentValue: 0,
    totalFees: 0,
    totalProfit: 0,
    averageAPR: 0,
    activePositions: 0,
    closedPositions: 0,
  };

  if (positions.length === 0) return summary;

  let aprWeightedNumerator = 0;
  let aprWeightDenominator = 0;

  for (const p of positions) {
    const deposited = getEffectiveDeposited(p);
    const fees = getEffectiveTotalFees(p, allClaims);
    const days = calcDaysActive(p.entryDatetime, p.exitDatetime);
    const priceDiff = calcPriceDiff(p.currentBalance, deposited);
    const profit = calcPositionProfit(p, fees, priceDiff);
    const apr = calcFeeAPR(fees, deposited, days);

    summary.totalDeposited += deposited;
    summary.totalCurrentValue += toFinite(p.currentBalance);
    summary.totalFees += fees;
    summary.totalProfit += profit;

    if (p.status === "active") summary.activePositions += 1;
    else summary.closedPositions += 1;

    if (deposited > 0) {
      aprWeightedNumerator += apr * deposited;
      aprWeightDenominator += deposited;
    }
  }

  summary.averageAPR =
    aprWeightDenominator > 0 ? aprWeightedNumerator / aprWeightDenominator : 0;

  return summary;
}
