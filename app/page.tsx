"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getClaims, getPositions } from "../lib/storage";
import {
  calcDaysActive,
  calcFeeAPR,
  calcPortfolioSummary,
  calcPositionProfit,
  calcPriceDiff,
  calcTotalFees,
  calcWideRangePercent,
  getEffectiveDeposited,
} from "../lib/calculations";
import type { FeeClaim, PortfolioSummary, Position } from "../lib/types";

const EMPTY_SUMMARY: PortfolioSummary = {
  totalDeposited: 0,
  totalCurrentValue: 0,
  totalFees: 0,
  totalProfit: 0,
  averageAPR: 0,
  activePositions: 0,
  closedPositions: 0,
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

function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(2)}%`;
}

function formatTokenAmount(value: number): string {
  return tokenFormatter.format(Number.isFinite(value) ? value : 0);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pnlColor(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-[var(--foreground)]";
}

function lastUpdatedTimestamp(
  positions: Position[],
  claims: FeeClaim[],
): string | null {
  let max = 0;
  const consider = (s: string | null | undefined) => {
    if (!s) return;
    const t = new Date(s).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  };
  for (const p of positions) {
    consider(p.entryDatetime);
    consider(p.exitDatetime);
  }
  for (const c of claims) consider(c.date);
  if (max === 0) return null;
  return formatDateTime(new Date(max).toISOString());
}

interface SummaryCardProps {
  label: string;
  value: string;
  valueClass?: string;
}

function SummaryCard({ label, value, valueClass }: SummaryCardProps) {
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
    </div>
  );
}

interface DerivedRow {
  position: Position;
  deposited: number;
  fees: number;
  days: number;
  apr: number;
  profit: number;
  rangeState: "in" | "out" | "unknown";
}

function rangeState(p: Position): "in" | "out" | "unknown" {
  if (
    !Number.isFinite(p.entryPrice) ||
    !Number.isFinite(p.bottomRange) ||
    !Number.isFinite(p.topRange) ||
    p.bottomRange === 0 ||
    p.topRange === 0
  ) {
    return "unknown";
  }
  return p.entryPrice >= p.bottomRange && p.entryPrice <= p.topRange
    ? "in"
    : "out";
}

function deriveRows(positions: Position[]): DerivedRow[] {
  return positions.map((position) => {
    const deposited = getEffectiveDeposited(position);
    const fees = calcTotalFees(position.claimed, position.newFees);
    const days = calcDaysActive(position.entryDatetime, position.exitDatetime);
    const apr = calcFeeAPR(fees, deposited, days);
    const priceDiff = calcPriceDiff(position.currentBalance, deposited);
    const profit = calcPositionProfit(position, fees, priceDiff);
    return {
      position,
      deposited,
      fees,
      days,
      apr,
      profit,
      rangeState: rangeState(position),
    };
  });
}

function recentClaims(claims: FeeClaim[]): FeeClaim[] {
  return [...claims]
    .sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      const safeA = Number.isFinite(ta) ? ta : 0;
      const safeB = Number.isFinite(tb) ? tb : 0;
      return safeB - safeA;
    })
    .slice(0, 5);
}

export default function DashboardPage() {
  const [hydrated, setHydrated] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);

  useEffect(() => {
    setPositions(getPositions());
    setClaims(getClaims());
    setHydrated(true);
  }, []);

  const summary = hydrated ? calcPortfolioSummary(positions) : EMPTY_SUMMARY;
  const activeRows = hydrated
    ? deriveRows(positions.filter((p) => p.status === "active"))
    : [];
  const claimRows = hydrated ? recentClaims(claims) : [];
  const lastUpdated = useMemo(
    () => (hydrated ? lastUpdatedTimestamp(positions, claims) : null),
    [hydrated, positions, claims],
  );

  const isEmpty = hydrated && positions.length === 0 && claims.length === 0;

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Portfolio overview across all tracked positions.
        </p>
        {lastUpdated && (
          <p className="mt-1 text-xs text-[var(--muted)]/80">
            Last updated {lastUpdated}
          </p>
        )}
      </header>

      {isEmpty ? (
        <WelcomeEmptyState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryCard
              label="Total Deposited"
              value={formatUsd(summary.totalDeposited)}
            />
            <SummaryCard
              label="Current Value"
              value={formatUsd(summary.totalCurrentValue)}
            />
            <SummaryCard
              label="Total Fees Earned"
              value={formatUsd(summary.totalFees)}
              valueClass={pnlColor(summary.totalFees)}
            />
            <SummaryCard
              label="Total Profit"
              value={formatUsd(summary.totalProfit)}
              valueClass={pnlColor(summary.totalProfit)}
            />
            <SummaryCard
              label="Average Fee APR"
              value={formatPercent(summary.averageAPR)}
            />
            <SummaryCard
              label="Active Positions"
              value={String(summary.activePositions)}
            />
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">
                Active Positions
              </h2>
              <span className="text-xs text-[var(--muted)]">
                {activeRows.length}{" "}
                {activeRows.length === 1 ? "position" : "positions"}
              </span>
            </div>

            {activeRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                No active positions yet. Go to Positions to add your first one.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Pair</th>
                      <th className="px-4 py-3 text-left font-medium">Chain</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Protocol
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Deposited
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Current Value
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Total Fees
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Fee APR
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Days Active
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Range %
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Profit
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {activeRows.map(
                      ({ position, deposited, fees, days, apr, profit, rangeState: rs }) => (
                        <tr
                          key={position.id}
                          className="transition-colors hover:bg-[var(--surface-2)]/60"
                        >
                          <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                            <div className="inline-flex items-center gap-2">
                              <RangeDot state={rs} />
                              {position.pair}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[var(--muted)]">
                            {position.chain}
                          </td>
                          <td className="px-4 py-3 text-[var(--muted)]">
                            {position.protocol}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatUsd(deposited)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatUsd(position.currentBalance)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatUsd(fees)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatPercent(apr)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                            {days.toFixed(1)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                            {(() => {
                              const wr = calcWideRangePercent(
                                position.bottomRange,
                                position.topRange,
                              );
                              return wr > 0 ? formatPercent(wr) : "—";
                            })()}
                          </td>
                          <td
                            className={`px-4 py-3 text-right tabular-nums font-medium ${pnlColor(profit)}`}
                          >
                            {formatUsd(profit)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                              {position.status}
                            </span>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">
                Recent Fee Claims
              </h2>
              <span className="text-xs text-[var(--muted)]">
                Last {claimRows.length} of {claims.length}
              </span>
            </div>

            {claimRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                No fee claims recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">Pair</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Platform
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Token 1 Amount
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Token 2 Amount
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Converted to Stable
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Stable Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {claimRows.map((claim) => (
                      <tr key={claim.id}>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {formatDate(claim.date)}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                          {claim.pair}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {claim.platform}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatTokenAmount(claim.token1Amount)}{" "}
                          <span className="text-[var(--muted)]">
                            {claim.token1Symbol}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatTokenAmount(claim.token2Amount)}{" "}
                          <span className="text-[var(--muted)]">
                            {claim.token2Symbol}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {claim.convertedToStable ? "Yes" : "No"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {claim.convertedToStable && claim.stableAmount !== null
                            ? `${formatTokenAmount(claim.stableAmount)} ${claim.stableSymbol ?? ""}`.trim()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

interface RangeDotProps {
  state: "in" | "out" | "unknown";
}

function RangeDot({ state }: RangeDotProps) {
  if (state === "unknown") return null;
  const tone =
    state === "in"
      ? "bg-emerald-400 ring-emerald-500/30"
      : "bg-rose-400 ring-rose-500/30";
  const title = state === "in" ? "In Range" : "Out of Range";
  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-block h-2 w-2 rounded-full ring-2 ring-inset ${tone}`}
    />
  );
}

function WelcomeEmptyState() {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
      <EmptyStateIcon />
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
        Welcome to CLP Tracker
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
        Start by adding your first LP position.
      </p>
      <Link
        href="/positions"
        className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
      >
        Add Position
      </Link>
    </div>
  );
}

function EmptyStateIcon() {
  return (
    <svg
      className="mx-auto h-10 w-10 text-[var(--muted)]/60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        d="M3 3v18h18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 14l3-3 3 3 4-5 4 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
