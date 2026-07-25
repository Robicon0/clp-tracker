// Data Health — one shared home for every "this record looks wrong" check in
// the app. Consolidates the position-symbol detector (a1b7176) and the
// claim-symbol detector (77df8e6), extends the same substring test to
// Transfers, and adds an unusual-amount outlier flag for claims and transfers.
//
// DETECTION ONLY. Nothing here mutates data. The `correct*` helpers return a
// COPY with the fix applied; persisting it is always an explicit, user-
// confirmed action in the UI. A genuinely large claim or an intentional token
// can be real, so every result is a "please double-check", never a rewrite.

import type { FeeClaim, Position, Transfer } from "./types";

// ---------------------------------------------------------------------------
// Shared pair parsing
// ---------------------------------------------------------------------------

// Strips a trailing fee-tier suffix like " (0.05%)" so "ETH/USDC (0.05%)"
// parses the same as "ETH/USDC". Positions store the tier separately, but
// claims sometimes fold it into the pair string.
export function pairCore(pair: string): string {
  const m = pair.match(/^(.+?)\s*\([^)]*\)\s*$/);
  return (m ? m[1] : pair).trim().toUpperCase();
}

// A symbol is plausible for a pair when it appears INSIDE the pair string.
// Substring, not equality, on purpose: Base "ETH" on pair "WETH/USDC" is a
// legitimate wrapper alias (ETH ⊂ WETH) and must not be flagged, while
// "SOL" ⊄ "SUI/USDC" is caught.
export function symbolMatchesPair(symbol: string, pairCoreStr: string): boolean {
  const s = symbol.trim().toUpperCase();
  return s === "" || pairCoreStr.includes(s);
}

// The two tokens of a pair, in order. "" for a side that cannot be parsed.
export function pairTokens(pairCoreStr: string): [string, string] {
  const [base = "", quote = ""] = pairCoreStr
    .split("/")
    .map((s) => s.trim().toUpperCase());
  return [base, quote];
}

// ---------------------------------------------------------------------------
// Position symbol ↔ pair mismatch (moved verbatim from calculations.ts)
// ---------------------------------------------------------------------------

export interface SymbolPairMismatchRow {
  position: Position;
  baseSymbol: string;
  quoteSymbol: string;
  // The symbols parsed from the Pair string itself (the likely-correct values).
  pairBase: string;
  pairQuote: string;
  baseMismatch: boolean;
  quoteMismatch: boolean;
  // Closed positions carry the higher risk: a token-amount-mode close fetched a
  // price FROM the wrong symbol and wrote it into Final Balance / Scalp, so the
  // stored dollars — not just the label — can be wrong.
  isClosed: boolean;
}

// Plausibility check (Invariant #8): a position's Base/Quote token symbol must
// appear inside its own Pair string. "SOL" on a "SUI/USDC" pair is impossible
// and means the symbol field holds the wrong token — which then drives every
// price lookup (live range bar, and critically the token-amount-mode close
// historical price) to the WRONG coin. Reports rather than repairs — only the
// user knows whether the Pair or the symbol is the typo.
export function findSymbolPairMismatches(
  positions: Position[],
): SymbolPairMismatchRow[] {
  const rows: SymbolPairMismatchRow[] = [];
  for (const p of positions) {
    const pair = pairCore(p.pair);
    if (pair === "") continue;
    const baseSymbol = p.token1Symbol.trim().toUpperCase();
    const quoteSymbol = p.token2Symbol.trim().toUpperCase();
    const baseMismatch = baseSymbol !== "" && !pair.includes(baseSymbol);
    const quoteMismatch = quoteSymbol !== "" && !pair.includes(quoteSymbol);
    if (!baseMismatch && !quoteMismatch) continue;
    const [pairBase, pairQuote] = pairTokens(pair);
    rows.push({
      position: p,
      baseSymbol,
      quoteSymbol,
      pairBase,
      pairQuote,
      baseMismatch,
      quoteMismatch,
      isClosed: p.status === "closed",
    });
  }
  // Closed (dollar-risk) positions first, then by pair for stable ordering.
  return rows.sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? -1 : 1;
    return a.position.pair.localeCompare(b.position.pair);
  });
}

// ---------------------------------------------------------------------------
// Claim symbol ↔ pair mismatch (moved verbatim from calculations.ts)
// ---------------------------------------------------------------------------

// Fee claims freeze their OWN token1Symbol/token2Symbol at creation (a static
// snapshot copied from the position), so a position mislabeled "SOL" mints
// claims that ALSO store "SOL" — and calcBusinessPnL sums the claim's stored
// symbol, inflating the wrong token's total. Fixing the position does NOT fix
// these claims. Each claim carries its own pair string, so the same substring
// test catches it.
export interface ClaimSymbolMismatchRow {
  claim: FeeClaim;
  baseSymbol: string;
  quoteSymbol: string;
  pairBase: string;
  pairQuote: string;
  baseMismatch: boolean;
  quoteMismatch: boolean;
}

export function findClaimSymbolMismatches(
  claims: FeeClaim[],
): ClaimSymbolMismatchRow[] {
  const rows: ClaimSymbolMismatchRow[] = [];
  for (const claim of claims) {
    const pair = pairCore(claim.pair);
    if (pair === "") continue;
    const baseSymbol = claim.token1Symbol.trim().toUpperCase();
    const quoteSymbol = claim.token2Symbol.trim().toUpperCase();
    const baseMismatch = baseSymbol !== "" && !pair.includes(baseSymbol);
    const quoteMismatch = quoteSymbol !== "" && !pair.includes(quoteSymbol);
    if (!baseMismatch && !quoteMismatch) continue;
    const [pairBase, pairQuote] = pairTokens(pair);
    rows.push({
      claim,
      baseSymbol,
      quoteSymbol,
      pairBase,
      pairQuote,
      baseMismatch,
      quoteMismatch,
    });
  }
  return rows;
}

// Real-vs-contamination subtotals: how much token quantity is filed under the
// WRONG symbol and which symbol it should be, aggregated across all flagged
// claims. This is the "X SOL is actually SUI" figure the Business P&L total is
// inflated by. Only counts a side when its pair token is known (non-empty).
export interface ClaimContaminationRow {
  wrongSymbol: string;
  correctSymbol: string;
  amount: number;
  claimCount: number;
}

export function summarizeClaimContamination(
  rows: ClaimSymbolMismatchRow[],
): ClaimContaminationRow[] {
  const map = new Map<string, ClaimContaminationRow>();
  const add = (wrong: string, correct: string, amount: number) => {
    if (correct === "" || !Number.isFinite(amount) || amount <= 0) return;
    const key = `${wrong}->${correct}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += amount;
      existing.claimCount += 1;
    } else {
      map.set(key, { wrongSymbol: wrong, correctSymbol: correct, amount, claimCount: 1 });
    }
  };
  for (const r of rows) {
    if (r.baseMismatch) add(r.baseSymbol, r.pairBase, r.claim.token1Amount);
    if (r.quoteMismatch) add(r.quoteSymbol, r.pairQuote, r.claim.token2Amount);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// The one-click correction: returns a copy of the claim with each mismatched
// side rewritten to the pair-derived symbol. A side whose pair token is unknown
// (empty) is left untouched — we never blank a symbol we cannot replace.
export function correctClaimSymbols(row: ClaimSymbolMismatchRow): FeeClaim {
  const next = { ...row.claim };
  if (row.baseMismatch && row.pairBase !== "") next.token1Symbol = row.pairBase;
  if (row.quoteMismatch && row.pairQuote !== "") next.token2Symbol = row.pairQuote;
  return next;
}

// ---------------------------------------------------------------------------
// Transfer symbol ↔ linked-position pair mismatch (Part 2)
// ---------------------------------------------------------------------------

// A Transfer stores both positionId and a single token symbol, so it can be
// checked against its linked position's pair with the same substring test. The
// correction TARGET must mirror how the automation assigns a transfer's token:
// an out-of-range-upside transfer carries the QUOTE symbol (buildUpsideTransfer)
// while a fee/undeployed transfer carries the volatile BASE symbol
// (buildClaimTransfer). A transfer whose position is missing or has no pair is
// skipped — it cannot be judged.
export interface TransferSymbolMismatchRow {
  transfer: Transfer;
  position: Position;
  token: string;
  pairBase: string;
  pairQuote: string;
  // The pair token this transfer's symbol most plausibly should have been,
  // chosen by transferType. "" when it cannot be determined (correction off).
  suggestedSymbol: string;
}

function suggestedTransferSymbol(
  transfer: Transfer,
  pairBase: string,
  pairQuote: string,
): string {
  return transfer.transferType === "outOfRangeUpside" ? pairQuote : pairBase;
}

export function findTransferSymbolMismatches(
  transfers: Transfer[],
  positions: Position[],
): TransferSymbolMismatchRow[] {
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const rows: TransferSymbolMismatchRow[] = [];
  for (const transfer of transfers) {
    const token = transfer.token.trim().toUpperCase();
    if (token === "") continue;
    const position = positionById.get(transfer.positionId);
    if (!position) continue;
    const pair = pairCore(position.pair);
    if (pair === "") continue;
    if (pair.includes(token)) continue;
    const [pairBase, pairQuote] = pairTokens(pair);
    rows.push({
      transfer,
      position,
      token,
      pairBase,
      pairQuote,
      suggestedSymbol: suggestedTransferSymbol(transfer, pairBase, pairQuote),
    });
  }
  return rows.sort((a, b) =>
    a.position.pair.localeCompare(b.position.pair),
  );
}

export function correctTransferSymbol(row: TransferSymbolMismatchRow): Transfer {
  if (row.suggestedSymbol === "") return { ...row.transfer };
  return { ...row.transfer, token: row.suggestedSymbol };
}

// ---------------------------------------------------------------------------
// Unusual-amount outliers for claims and transfers (Part 3)
// ---------------------------------------------------------------------------

// An extra/missing zero is a 10× shift. We compare a record's USD amount to the
// MAX (for "too high") / MIN (for "too low") of the OTHER records on the same
// position — so even the position's largest legitimate record must be dwarfed
// tenfold before we flag. That makes normal 2–3× variation invisible to the
// check; it essentially only catches order-of-magnitude data-entry slips. We
// require at least MIN_SIBLINGS other records so a single data point never
// defines "typical". Flag only — a big claim can be genuine.
export const OUTLIER_MULTIPLIER = 10;
export const OUTLIER_MIN_SIBLINGS = 2;

export type OutlierKind = "claim" | "transfer";

export interface OutlierRow {
  kind: OutlierKind;
  id: string;
  positionId: string;
  position: Position | null;
  label: string;
  date: string;
  amount: number;
  direction: "high" | "low";
  // The typical band (min/max of the sibling records) this one broke out of.
  typicalMin: number;
  typicalMax: number;
  siblingCount: number;
  claim?: FeeClaim;
  transfer?: Transfer;
}

interface AmountRecord {
  id: string;
  positionId: string;
  date: string;
  amount: number;
}

// Core outlier pass, shared by claims and transfers. Groups valid amounts by
// position, then flags any record an order of magnitude beyond every sibling.
function findAmountOutliers(
  records: AmountRecord[],
): Array<AmountRecord & { direction: "high" | "low"; typicalMin: number; typicalMax: number; siblingCount: number }> {
  const byPosition = new Map<string, AmountRecord[]>();
  for (const r of records) {
    if (r.positionId === "") continue;
    if (!Number.isFinite(r.amount) || r.amount <= 0) continue;
    const list = byPosition.get(r.positionId);
    if (list) list.push(r);
    else byPosition.set(r.positionId, [r]);
  }
  const out: Array<
    AmountRecord & { direction: "high" | "low"; typicalMin: number; typicalMax: number; siblingCount: number }
  > = [];
  for (const list of byPosition.values()) {
    if (list.length <= OUTLIER_MIN_SIBLINGS) continue; // need candidate + ≥2 siblings
    for (const candidate of list) {
      const siblings = list.filter((r) => r !== candidate);
      if (siblings.length < OUTLIER_MIN_SIBLINGS) continue;
      const amounts = siblings.map((s) => s.amount);
      const maxOther = Math.max(...amounts);
      const minOther = Math.min(...amounts);
      let direction: "high" | "low" | null = null;
      if (candidate.amount >= OUTLIER_MULTIPLIER * maxOther) direction = "high";
      else if (candidate.amount <= minOther / OUTLIER_MULTIPLIER) direction = "low";
      if (!direction) continue;
      out.push({
        ...candidate,
        direction,
        typicalMin: minOther,
        typicalMax: maxOther,
        siblingCount: siblings.length,
      });
    }
  }
  return out;
}

export function findClaimAmountOutliers(
  claims: FeeClaim[],
  positions: Position[] = [],
): OutlierRow[] {
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const records: AmountRecord[] = claims
    .filter((c) => c.stableAmount !== null && Number.isFinite(c.stableAmount))
    .map((c) => ({
      id: c.id,
      positionId: c.positionId,
      date: c.date,
      amount: c.stableAmount as number,
    }));
  const claimById = new Map(claims.map((c) => [c.id, c]));
  return findAmountOutliers(records)
    .map((r) => {
      const claim = claimById.get(r.id);
      const position = positionById.get(r.positionId) ?? null;
      return {
        kind: "claim" as const,
        id: r.id,
        positionId: r.positionId,
        position,
        label: claim?.pair || position?.pair || "—",
        date: r.date,
        amount: r.amount,
        direction: r.direction,
        typicalMin: r.typicalMin,
        typicalMax: r.typicalMax,
        siblingCount: r.siblingCount,
        claim,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export function findTransferAmountOutliers(
  transfers: Transfer[],
  positions: Position[] = [],
): OutlierRow[] {
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const records: AmountRecord[] = transfers.map((t) => ({
    id: t.id,
    positionId: t.positionId,
    date: t.date,
    amount: t.amount,
  }));
  const transferById = new Map(transfers.map((t) => [t.id, t]));
  return findAmountOutliers(records)
    .map((r) => {
      const transfer = transferById.get(r.id);
      const position = positionById.get(r.positionId) ?? null;
      return {
        kind: "transfer" as const,
        id: r.id,
        positionId: r.positionId,
        position,
        label:
          position?.pair || transfer?.destination || transfer?.token || "—",
        date: r.date,
        amount: r.amount,
        direction: r.direction,
        typicalMin: r.typicalMin,
        typicalMax: r.typicalMax,
        siblingCount: r.siblingCount,
        transfer,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Consolidated report (Part 4)
// ---------------------------------------------------------------------------

export interface DataHealthCounts {
  positionSymbol: number;
  claimSymbol: number;
  transferSymbol: number;
  claimOutliers: number;
  transferOutliers: number;
  total: number;
}

export interface DataHealthReport {
  positionSymbol: SymbolPairMismatchRow[];
  claimSymbol: ClaimSymbolMismatchRow[];
  transferSymbol: TransferSymbolMismatchRow[];
  claimOutliers: OutlierRow[];
  transferOutliers: OutlierRow[];
  counts: DataHealthCounts;
}

export function computeDataHealth(
  positions: Position[],
  claims: FeeClaim[],
  transfers: Transfer[],
): DataHealthReport {
  const positionSymbol = findSymbolPairMismatches(positions);
  const claimSymbol = findClaimSymbolMismatches(claims);
  const transferSymbol = findTransferSymbolMismatches(transfers, positions);
  const claimOutliers = findClaimAmountOutliers(claims, positions);
  const transferOutliers = findTransferAmountOutliers(transfers, positions);
  const counts: DataHealthCounts = {
    positionSymbol: positionSymbol.length,
    claimSymbol: claimSymbol.length,
    transferSymbol: transferSymbol.length,
    claimOutliers: claimOutliers.length,
    transferOutliers: transferOutliers.length,
    total:
      positionSymbol.length +
      claimSymbol.length +
      transferSymbol.length +
      claimOutliers.length +
      transferOutliers.length,
  };
  return {
    positionSymbol,
    claimSymbol,
    transferSymbol,
    claimOutliers,
    transferOutliers,
    counts,
  };
}
