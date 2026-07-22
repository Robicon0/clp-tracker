"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getClaims,
  getPositions,
  getSettings,
  getTransfers,
  saveSettings,
} from "../../lib/storage";
import {
  calcDaysActive,
  calcFeeAPR,
  calcOverallPnL,
  calcPositionProfit,
  calcPriceDiff,
  getEffectiveDeposited,
  getEffectiveTotalFees,
  type OverallPnL,
} from "../../lib/calculations";
import {
  InitialCapitalCard,
  OverallPnLCard,
} from "../../components/CapitalCards";
import { GrowthTargetSection } from "../../components/GrowthTarget";
import { useHydrated } from "../../lib/useHydrated";
import type { FeeClaim, Position, Transfer } from "../../lib/types";

const EMPTY_OVERALL: OverallPnL = {
  activeCurrentValue: 0,
  convertedFees: 0,
  expenses: 0,
  initialCapital: 0,
  overall: 0,
  unvaluedConvertedClaims: 0,
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const tokenFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function formatUsd(value: number): string {
  return usdFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatToken(value: number): string {
  return tokenFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(2)}%`;
}

function pnlColor(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-[var(--foreground)]";
}

function pnlBorder(value: number): string {
  if (value > 0) return "border-emerald-500/40";
  if (value < 0) return "border-rose-500/40";
  return "border-[var(--border-strong)]";
}

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI"]);

interface PortfolioTotals {
  totalInvested: number;
  totalCurrentValue: number;
  totalFees: number;
  totalShortPnL: number;
  lpPnL: number;
  netPnL: number;
}

interface SegmentSummary {
  count: number;
  invested: number;
  fees: number;
  weightedApr: number;
  weight: number;
  profit: number;
  best: { pair: string; apr: number } | null;
}

interface TokenRow {
  symbol: string;
  claimCount: number;
  totalAmount: number;
  converted: "yes" | "no" | "stable";
  stableSum: number;
}

interface MonthRow {
  monthKey: string;
  monthLabel: string;
  claimCount: number;
  totalFeesUsd: number;
  positionsActive: number;
}

function computeTotals(
  positions: Position[],
  allClaims: FeeClaim[],
): PortfolioTotals {
  let totalInvested = 0;
  let totalCurrentValue = 0;
  let totalFees = 0;
  let totalShortPnL = 0;
  for (const p of positions) {
    totalInvested += getEffectiveDeposited(p);
    totalCurrentValue += p.currentBalance;
    totalFees += getEffectiveTotalFees(p, allClaims);
    if (p.shortTotal !== null && Number.isFinite(p.shortTotal)) {
      totalShortPnL += p.shortTotal;
    }
  }
  const lpPnL = totalCurrentValue - totalInvested;
  return {
    totalInvested,
    totalCurrentValue,
    totalFees,
    totalShortPnL,
    lpPnL,
    netPnL: lpPnL + totalFees + totalShortPnL,
  };
}

function emptySegment(): SegmentSummary {
  return {
    count: 0,
    invested: 0,
    fees: 0,
    weightedApr: 0,
    weight: 0,
    profit: 0,
    best: null,
  };
}

function summarizeSegment(
  positions: Position[],
  allClaims: FeeClaim[],
): SegmentSummary {
  const out = emptySegment();
  for (const p of positions) {
    const deposited = getEffectiveDeposited(p);
    const fees = getEffectiveTotalFees(p, allClaims);
    const days = calcDaysActive(p.entryDatetime, p.exitDatetime);
    const apr = calcFeeAPR(fees, deposited, days);
    const priceDiff = calcPriceDiff(p.currentBalance, deposited);
    const profit = calcPositionProfit(p, fees, priceDiff);
    out.count += 1;
    out.invested += deposited;
    out.fees += fees;
    out.profit += profit;
    if (deposited > 0) {
      out.weightedApr += apr * deposited;
      out.weight += deposited;
    }
    if (out.best === null || apr > out.best.apr) {
      out.best = { pair: p.pair, apr };
    }
  }
  return out;
}

function buildTokenRows(claims: FeeClaim[]): TokenRow[] {
  type Acc = {
    symbol: string;
    claimIds: Set<string>;
    totalAmount: number;
    convertedClaims: Set<string>;
    stableContributed: Map<string, number>; // claimId -> stableAmount once
  };
  const map = new Map<string, Acc>();

  const ensure = (sym: string): Acc => {
    let acc = map.get(sym);
    if (!acc) {
      acc = {
        symbol: sym,
        claimIds: new Set(),
        totalAmount: 0,
        convertedClaims: new Set(),
        stableContributed: new Map(),
      };
      map.set(sym, acc);
    }
    return acc;
  };

  for (const c of claims) {
    const sides: Array<{ sym: string; amt: number }> = [];
    if (c.token1Symbol) sides.push({ sym: c.token1Symbol, amt: c.token1Amount });
    if (c.token2Symbol) sides.push({ sym: c.token2Symbol, amt: c.token2Amount });
    for (const { sym, amt } of sides) {
      const acc = ensure(sym);
      acc.claimIds.add(c.id);
      acc.totalAmount += Number.isFinite(amt) ? amt : 0;
      if (c.convertedToStable) {
        acc.convertedClaims.add(c.id);
        if (
          c.stableAmount !== null &&
          Number.isFinite(c.stableAmount) &&
          !acc.stableContributed.has(c.id)
        ) {
          acc.stableContributed.set(c.id, c.stableAmount);
        }
      }
    }
  }

  const rows: TokenRow[] = [];
  for (const acc of map.values()) {
    const isStable = STABLE_SYMBOLS.has(acc.symbol);
    let stableSum = 0;
    for (const v of acc.stableContributed.values()) stableSum += v;
    rows.push({
      symbol: acc.symbol,
      claimCount: acc.claimIds.size,
      totalAmount: acc.totalAmount,
      converted: isStable
        ? "stable"
        : acc.convertedClaims.size > 0
          ? "yes"
          : "no",
      stableSum: isStable ? 0 : stableSum,
    });
  }
  rows.sort((a, b) => b.claimCount - a.claimCount || a.symbol.localeCompare(b.symbol));
  return rows;
}

function buildMonthRows(claims: FeeClaim[], positions: Position[]): MonthRow[] {
  const buckets = new Map<string, { claimCount: number; feesUsd: number; date: Date }>();
  for (const c of claims) {
    const d = new Date(c.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { claimCount: 0, feesUsd: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) };
      buckets.set(key, bucket);
    }
    bucket.claimCount += 1;
    // USD value counts regardless of conversion status (Invariant #10)
    if (c.stableAmount !== null && Number.isFinite(c.stableAmount)) {
      bucket.feesUsd += c.stableAmount;
    }
  }

  const rows: MonthRow[] = [];
  for (const [key, b] of buckets) {
    const monthStart = b.date.getTime();
    const monthEnd = new Date(b.date.getFullYear(), b.date.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    let positionsActive = 0;
    for (const p of positions) {
      const entry = new Date(p.entryDatetime).getTime();
      if (!Number.isFinite(entry) || entry > monthEnd) continue;
      const exitRaw = p.exitDatetime ? new Date(p.exitDatetime).getTime() : null;
      if (exitRaw !== null && Number.isFinite(exitRaw) && exitRaw < monthStart) continue;
      positionsActive += 1;
    }
    rows.push({
      monthKey: key,
      monthLabel: b.date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      claimCount: b.claimCount,
      totalFeesUsd: b.feesUsd,
      positionsActive,
    });
  }
  rows.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));
  return rows;
}

export default function TotalPnlPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [initialCapital, setInitialCapital] = useState(0);
  const [targetMonthlyPercent, setTargetMonthlyPercent] = useState(0);

  const hydrated = useHydrated(() => {
    setPositions(getPositions());
    setClaims(getClaims());
    setTransfers(getTransfers());
    const settings = getSettings();
    setInitialCapital(settings.initialCapital);
    setTargetMonthlyPercent(settings.targetMonthlyPercent);
  });

  // Portfolio Summary describes what is deployed right now, so it spans open
  // positions only — capital in a closed position has been withdrawn. Net P&L
  // is a sum of the cards beside it, so every one of them must share that
  // scope or the row stops adding up. Closed positions are not hidden: their
  // realised numbers keep their own column in the Active/Closed breakdown
  // below, and Lifetime Total Deposited spans everything ever opened.
  const totals = useMemo(
    () =>
      hydrated
        ? computeTotals(
            positions.filter((p) => p.status === "active"),
            claims,
          )
        : {
            totalInvested: 0,
            totalCurrentValue: 0,
            totalFees: 0,
            totalShortPnL: 0,
            lpPnL: 0,
            netPnL: 0,
          },
    [hydrated, positions, claims],
  );

  const handleSaveInitialCapital = (next: number) => {
    saveSettings({ ...getSettings(), initialCapital: next });
    setInitialCapital(next);
  };

  const handleSaveTarget = (next: number) => {
    saveSettings({ ...getSettings(), targetMonthlyPercent: next });
    setTargetMonthlyPercent(next);
  };

  const overall = useMemo(
    () =>
      hydrated
        ? calcOverallPnL(positions, claims, transfers, initialCapital)
        : EMPTY_OVERALL,
    [hydrated, positions, claims, transfers, initialCapital],
  );

  const lifetimeDeposited = useMemo(
    () =>
      hydrated
        ? positions.reduce((sum, p) => sum + getEffectiveDeposited(p), 0)
        : 0,
    [hydrated, positions],
  );

  const activeSummary = useMemo(
    () =>
      hydrated
        ? summarizeSegment(
            positions.filter((p) => p.status === "active"),
            claims,
          )
        : emptySegment(),
    [hydrated, positions, claims],
  );

  const closedSummary = useMemo(
    () =>
      hydrated
        ? summarizeSegment(
            positions.filter((p) => p.status === "closed"),
            claims,
          )
        : emptySegment(),
    [hydrated, positions, claims],
  );

  const tokenRows = useMemo(
    () => (hydrated ? buildTokenRows(claims) : []),
    [hydrated, claims],
  );

  const monthRows = useMemo(
    () => (hydrated ? buildMonthRows(claims, positions) : []),
    [hydrated, claims, positions],
  );

  const isEmpty = hydrated && positions.length === 0 && claims.length === 0;

  return (
    <section className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Total P&amp;L</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Complete overview of your DeFi LP performance.
        </p>
      </header>

      {isEmpty ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center">
          <EmptyIcon />
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            No data yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Add positions and log fee claims to see your complete P&amp;L
            overview.
          </p>
          <Link
            href="/positions"
            className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
          >
            Go to Positions
          </Link>
        </div>
      ) : (
        <>
          <PortfolioSummarySection
            totals={totals}
            lifetimeDeposited={lifetimeDeposited}
            overall={overall}
            initialCapital={initialCapital}
            onSaveInitialCapital={handleSaveInitialCapital}
          />
          <GrowthTargetSection
            positions={positions}
            claims={claims}
            initialCapital={initialCapital}
            targetMonthlyPercent={targetMonthlyPercent}
            onSaveTarget={handleSaveTarget}
          />
          <PerformanceBreakdownSection
            active={activeSummary}
            closed={closedSummary}
          />
          <FeeIncomeSection rows={tokenRows} />
          <MonthlyPerformanceSection rows={monthRows} />
        </>
      )}
    </section>
  );
}

function EmptyIcon() {
  return (
    <svg
      className="mx-auto h-10 w-10 text-[var(--muted)]/60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 14l3-3 3 3 4-5 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PortfolioSummarySectionProps {
  totals: PortfolioTotals;
  lifetimeDeposited: number;
  overall: OverallPnL;
  initialCapital: number;
  onSaveInitialCapital: (next: number) => void;
}

function PortfolioSummarySection({
  totals,
  lifetimeDeposited,
  overall,
  initialCapital,
  onSaveInitialCapital,
}: PortfolioSummarySectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeading title="Portfolio Summary" />
      <p className="-mt-1 text-xs text-[var(--muted)]">
        Open positions only — closed positions keep their own column in the
        Active vs Closed breakdown below.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BigStat
          label="Total Invested (Active)"
          value={formatUsd(totals.totalInvested)}
          hint="Capital currently deployed in open positions."
        />
        <BigStat
          label="Lifetime Total Deposited"
          value={formatUsd(lifetimeDeposited)}
          hint="All positions ever opened, including closed."
        />
        <BigStat
          label="Total Current Value"
          value={formatUsd(totals.totalCurrentValue)}
        />
        {/* Scoped label on purpose: the Dashboard's "Total Fees Earned" spans
            every position ever, so reusing that exact name here — where it is
            an addend of an active-only Net P&L — would put two different
            numbers under one label and break Invariant #6. */}
        <BigStat
          label="Fees Earned (Active)"
          value={formatUsd(totals.totalFees)}
          valueClass={pnlColor(totals.totalFees)}
          hint="Fees on open positions. Closed-position fees appear in the breakdown below."
        />
        <BigStat
          label="Total Short P&L"
          value={formatUsd(totals.totalShortPnL)}
          valueClass={pnlColor(totals.totalShortPnL)}
        />
        <BigStat
          label="LP P&L"
          value={formatUsd(totals.lpPnL)}
          valueClass={pnlColor(totals.lpPnL)}
          hint="Sum of (current value − deposited) across open positions. Price movement only, before fees."
        />
        <NetPnlCard value={totals.netPnL} />
        <InitialCapitalCard
          value={initialCapital}
          onSave={onSaveInitialCapital}
        />
        <OverallPnLCard result={overall} />
      </div>
    </div>
  );
}

interface BigStatProps {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}

function BigStat({ label, value, valueClass, hint }: BigStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold tracking-tight ${valueClass ?? "text-[var(--foreground)]"}`}
      >
        {value}
      </div>
      {hint && <p className="mt-2 text-[11px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

interface NetPnlCardProps {
  value: number;
}

function NetPnlCard({ value }: NetPnlCardProps) {
  return (
    <div
      className={`rounded-lg border-2 ${pnlBorder(value)} bg-[var(--surface)] p-6 shadow-lg`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
        Net P&amp;L
      </div>
      <div
        className={`mt-2 text-4xl font-bold tracking-tight tabular-nums ${pnlColor(value)}`}
      >
        {formatUsd(value)}
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        LP P&amp;L + Total Fees + Short P&amp;L
      </p>
    </div>
  );
}

interface PerformanceBreakdownSectionProps {
  active: SegmentSummary;
  closed: SegmentSummary;
}

function PerformanceBreakdownSection({
  active,
  closed,
}: PerformanceBreakdownSectionProps) {
  const avgApr = active.weight > 0 ? active.weightedApr / active.weight : 0;
  return (
    <div className="space-y-3">
      <SectionHeading title="Performance Breakdown" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SegmentCard
          title="Active Positions Summary"
          rows={[
            { label: "Active positions", value: String(active.count) },
            { label: "Total invested", value: formatUsd(active.invested) },
            { label: "Total fees earned", value: formatUsd(active.fees) },
            { label: "Average Fee APR", value: formatPercent(avgApr) },
            {
              label: "Best performing",
              value: active.best
                ? `${active.best.pair} · ${formatPercent(active.best.apr)}`
                : "—",
            },
          ]}
        />
        <SegmentCard
          title="Closed Positions Summary"
          rows={[
            { label: "Closed positions", value: String(closed.count) },
            { label: "Total invested", value: formatUsd(closed.invested) },
            { label: "Total fees earned", value: formatUsd(closed.fees) },
            {
              label: "Total profit",
              value: formatUsd(closed.profit),
              valueClass: pnlColor(closed.profit),
            },
          ]}
        />
      </div>
    </div>
  );
}

interface SegmentRow {
  label: string;
  value: string;
  valueClass?: string;
}

interface SegmentCardProps {
  title: string;
  rows: SegmentRow[];
}

function SegmentCard({ title, rows }: SegmentCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <dl className="mt-4 divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 py-2.5"
          >
            <dt className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
              {row.label}
            </dt>
            <dd
              className={`text-sm font-medium tabular-nums ${row.valueClass ?? "text-[var(--foreground)]"}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface FeeIncomeSectionProps {
  rows: TokenRow[];
}

function FeeIncomeSection({ rows }: FeeIncomeSectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeading title="Fee Income Breakdown" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
            No fee income recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Token</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Total Claims
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Total Amount
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Converted to Stable
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Total Stable Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <tr key={row.symbol}>
                    <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                      {row.symbol}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.claimCount}{" "}
                      <span className="text-[var(--muted)]">
                        {row.claimCount === 1 ? "claim" : "claims"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatToken(row.totalAmount)}{" "}
                      <span className="text-[var(--muted)]">{row.symbol}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {row.converted === "stable"
                        ? "—"
                        : row.converted === "yes"
                          ? "Yes"
                          : "No"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.converted === "stable" || row.stableSum === 0
                        ? "—"
                        : formatUsd(row.stableSum)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface MonthlyPerformanceSectionProps {
  rows: MonthRow[];
}

function MonthlyPerformanceSection({ rows }: MonthlyPerformanceSectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeading title="Monthly Performance" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
            No claims recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Month</th>
                  <th className="px-4 py-3 text-right font-medium">Claims</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Total Fees (USD)
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Positions Active
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <tr key={row.monthKey}>
                    <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                      {row.monthLabel}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.claimCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatUsd(row.totalFeesUsd)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.positionsActive}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface SectionHeadingProps {
  title: string;
}

function SectionHeading({ title }: SectionHeadingProps) {
  return (
    <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
      {title}
    </h2>
  );
}
