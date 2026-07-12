import type { PortfolioSummary, Position } from "./types";

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
  if (t1 > 0 && t1pL > 0) {
    L = t1 / t1pL;
  } else if (t0 > 0 && t0pL > 0) {
    L = t0 / t0pL;
  } else {
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

export function calcPortfolioSummary(positions: Position[]): PortfolioSummary {
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
    const fees = calcTotalFees(p.claimed, p.newFees);
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
