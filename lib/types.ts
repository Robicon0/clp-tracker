export interface Position {
  id: string;
  pair: string;
  chain: string;
  protocol: string;
  entryDatetime: string;
  exitDatetime: string | null;
  deposited: number;
  currentBalance: number;
  newFees: number;
  claimed: number;
  totalFees: number;
  bottomRange: number;
  topRange: number;
  token1Symbol: string;
  token2Symbol: string;
  token1Count: number;
  token2Count: number;
  entryPrice: number;
  shortDateStart: string | null;
  shortDateEnd: string | null;
  shortTokenAmount: number | null;
  shortUsdAmount: number | null;
  shortGain: number | null;
  shortLoss: number | null;
  shortFundingFees: number | null;
  shortTotal: number | null;
  shortNotes: string | null;
  outOfRangeUpside: number | null;
  outOfRangeDownside: number | null;
  scalp: number | null;
  txLink: string | null;
  notes: string;
  status: "active" | "closed";
}

export interface FeeClaim {
  id: string;
  positionId: string;
  date: string;
  pair: string;
  platform: string;
  chain: string;
  token1Symbol: string;
  token1Amount: number;
  token2Symbol: string;
  token2Amount: number;
  convertedToStable: boolean;
  stableSymbol: string | null;
  stableAmount: number | null;
  currentPositionValue: number | null;
  txId: string | null;
  notes: string;
}

export interface Transfer {
  id: string;
  positionId: string;
  date: string;
  token: string;
  amount: number;
  platform: string;
  // Where the money was moved TO (the sheet's TRANSFER column, e.g.
  // "RAKA TEZ", "AAVE BASE"). Optional — legacy records default to "".
  destination: string;
  transferType: "fees" | "undeployed" | "outOfRangeUpside";
  notes: string;
}

// Money taken OUT of the business for personal/other use (Sprint 10).
// Distinct from Transfer (which moves money between protocols/destinations
// but keeps it in the business). Withdrawals draw down Available Balance;
// Lifetime Earned (Σ transfers) is never reduced by them.
export interface Withdrawal {
  id: string;
  date: string;
  amount: number;
  method: string;
  notes: string;
}

export interface LPRange {
  id: string;
  positionId: string;
  pair: string;
  entryPrice: number;
  bottomRange: number;
  topRange: number;
  token1Symbol: string;
  token2Symbol: string;
  token1Count: number;
  token2Count: number;
  entryDatetime: string;
}

export interface PoolPnLEntry {
  id: string;
  positionId: string;
  pair: string;
  chain: string;
  protocol: string;
  shortDateStart: string | null;
  shortDateEnd: string | null;
  shortTokenAmount: number | null;
  shortUsdAmount: number | null;
  shortGain: number | null;
  shortLoss: number | null;
  shortFundingFees: number | null;
  shortTotal: number | null;
  shortNotes: string | null;
  outOfRangeUpside: number | null;
  outOfRangeDownside: number | null;
  entryDatetime: string;
}

export interface AppSettings {
  transfersEnabled: boolean;
  currency: "USD";
}

export interface PortfolioSummary {
  totalDeposited: number;
  totalCurrentValue: number;
  totalFees: number;
  totalProfit: number;
  averageAPR: number;
  activePositions: number;
  closedPositions: number;
}
