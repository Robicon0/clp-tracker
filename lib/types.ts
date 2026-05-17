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
  transferType: "fees" | "undeployed" | "outOfRangeUpside";
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
