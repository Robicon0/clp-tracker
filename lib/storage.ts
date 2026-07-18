import type {
  AppSettings,
  FeeClaim,
  LPRange,
  PoolPnLEntry,
  Position,
  Transfer,
} from "./types";

const KEYS = {
  positions: "clp_positions",
  claims: "clp_claims",
  transfers: "clp_transfers",
  settings: "clp_settings",
  ranges: "clp_ranges",
  poolPnl: "clp_pool_pnl",
  businessPnl: "clp_business_pnl",
} as const;

const DEFAULT_SETTINGS: AppSettings = {
  transfersEnabled: true,
  currency: "USD",
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readArray<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeValue<T>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — fail silently.
  }
}

export function getPositions(): Position[] {
  return readArray<Position>(KEYS.positions);
}

export function savePositions(positions: Position[]): void {
  writeValue(KEYS.positions, positions);
}

export function getClaims(): FeeClaim[] {
  return readArray<FeeClaim>(KEYS.claims);
}

export function saveClaims(claims: FeeClaim[]): void {
  writeValue(KEYS.claims, claims);
}

export function getTransfers(): Transfer[] {
  return readArray<Transfer>(KEYS.transfers);
}

export function saveTransfers(transfers: Transfer[]): void {
  writeValue(KEYS.transfers, transfers);
}

export function getSettings(): AppSettings {
  if (!isBrowser()) return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  writeValue(KEYS.settings, settings);
}

export function getRanges(): LPRange[] {
  return readArray<LPRange>(KEYS.ranges);
}

export function saveRanges(ranges: LPRange[]): void {
  writeValue(KEYS.ranges, ranges);
}

export function getPoolPnL(): PoolPnLEntry[] {
  return readArray<PoolPnLEntry>(KEYS.poolPnl);
}

export function savePoolPnL(entries: PoolPnLEntry[]): void {
  writeValue(KEYS.poolPnl, entries);
}

export interface BusinessPnLSettings {
  prices: Record<string, number>;
  checkpoints: string[];
}

export function getBusinessPnLSettings(): BusinessPnLSettings {
  if (!isBrowser()) return { prices: {}, checkpoints: [] };
  try {
    const raw = window.localStorage.getItem(KEYS.businessPnl);
    if (!raw) return { prices: {}, checkpoints: [] };
    const parsed = JSON.parse(raw) as Partial<BusinessPnLSettings>;
    return {
      prices:
        parsed.prices && typeof parsed.prices === "object"
          ? parsed.prices
          : {},
      checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
    };
  } catch {
    return { prices: {}, checkpoints: [] };
  }
}

export function saveBusinessPnLSettings(settings: BusinessPnLSettings): void {
  writeValue(KEYS.businessPnl, settings);
}
