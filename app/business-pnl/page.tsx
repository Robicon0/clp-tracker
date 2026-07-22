"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getBusinessPnLSettings,
  getClaims,
  saveBusinessPnLSettings,
  type BusinessPnLSettings,
} from "../../lib/storage";
import {
  calcBusinessPnL,
  calcUnconvertedHoldings,
  calcYieldAfter,
} from "../../lib/calculations";
import { useHydrated } from "../../lib/useHydrated";
import { mergePrices, useTokenPrices } from "../../lib/useTokenPrices";
import type { FeeClaim } from "../../lib/types";

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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function pnlColor(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-[var(--foreground)]";
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputClass =
  "block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 [color-scheme:dark] caret-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

function claimStatus(claim: FeeClaim): string {
  if (claim.convertedToStable) {
    return `Converted${claim.stableSymbol ? ` → ${claim.stableSymbol}` : ""}`;
  }
  if (claim.token1Amount > 0 && claim.token1Symbol.trim() !== "") {
    return `Still in ${claim.token1Symbol.trim().toUpperCase()}`;
  }
  return "Unconverted";
}

export default function BusinessPnlPage() {
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [settings, setSettings] = useState<BusinessPnLSettings>({
    prices: {},
    checkpoints: [],
  });
  const [newCheckpoint, setNewCheckpoint] = useState("");
  // Current prices for every reward token seen in claims. Manual entries in
  // settings.prices always override a fetched price (see effectivePrices
  // below), so auto-refresh never clobbers a user value. Shared with the
  // Growth Target card via the hook so both value fees identically.
  const {
    fetchedPrices,
    updatedAt: priceUpdatedAt,
    loading: priceLoading,
    error: priceError,
    refresh: refreshPrices,
  } = useTokenPrices(claims);

  const hydrated = useHydrated(() => {
    setClaims(getClaims());
    setSettings(getBusinessPnLSettings());
  });

  const persist = (next: BusinessPnLSettings) => {
    setSettings(next);
    saveBusinessPnLSettings(next);
  };

  // Manual overrides win over fetched prices. Storing a manual value equal to
  // the fetched price is pointless (and would freeze it against future
  // refreshes), so we drop it — clearing the field also reverts to auto.
  const setPrice = (token: string, raw: string) => {
    const prices = { ...settings.prices };
    const value = Number(raw);
    const fetched = fetchedPrices[token];
    const matchesFetched =
      Number.isFinite(fetched) && Math.abs(value - fetched) < 1e-9;
    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
      delete prices[token];
    } else if (matchesFetched) {
      delete prices[token];
    } else {
      prices[token] = value;
    }
    persist({ ...settings, prices });
  };

  // What every calculation and input uses: manual override, else fetched.
  const effectivePrices = useMemo(
    () => mergePrices(fetchedPrices, settings.prices),
    [fetchedPrices, settings.prices],
  );

  const addCheckpoint = () => {
    if (newCheckpoint.trim() === "") return;
    if (settings.checkpoints.includes(newCheckpoint)) return;
    const checkpoints = [...settings.checkpoints, newCheckpoint].sort();
    persist({ ...settings, checkpoints });
    setNewCheckpoint("");
  };

  const removeCheckpoint = (date: string) => {
    persist({
      ...settings,
      checkpoints: settings.checkpoints.filter((c) => c !== date),
    });
  };

  const business = useMemo(
    () => calcBusinessPnL(claims, effectivePrices),
    [claims, effectivePrices],
  );

  const holdings = useMemo(
    () => calcUnconvertedHoldings(claims, effectivePrices),
    [claims, effectivePrices],
  );

  const checkpointRows = useMemo(
    () =>
      settings.checkpoints.map((date) => ({
        date,
        accumulated: calcYieldAfter(claims, date),
      })),
    [claims, settings.checkpoints],
  );

  // Ledger blocks mirror the sheet's PAIRS blocks, grouped by chain.
  const ledgerBlocks = useMemo(() => {
    const byChain = new Map<string, FeeClaim[]>();
    for (const claim of claims) {
      const chain = claim.chain.trim().toUpperCase() || "OTHER";
      const list = byChain.get(chain);
      if (list) list.push(claim);
      else byChain.set(chain, [claim]);
    }
    const blocks = [...byChain.entries()].map(([chain, list]) => {
      const sorted = [...list].sort((a, b) => {
        const ta = new Date(a.date).getTime();
        const tb = new Date(b.date).getTime();
        return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
      });
      let usdTotal = 0;
      for (const claim of sorted) {
        if (claim.stableAmount !== null && Number.isFinite(claim.stableAmount)) {
          usdTotal += claim.stableAmount;
        }
      }
      return { chain, claims: sorted, usdTotal };
    });
    blocks.sort((a, b) => b.usdTotal - a.usdTotal);
    return blocks;
  }, [claims]);

  if (!hydrated) return null;

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Business P&amp;L
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Fee income by reward token — lifetime quantities, current value, and
          claim-time USD value.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat
          label="All Total (Current Value)"
          value={formatUsd(business.allTotal)}
          hint="Reward tokens × current price"
        />
        <SummaryStat
          label="Usdc Converted (Claim-Time Value)"
          value={formatUsd(business.usdcConverted)}
          hint="Σ USD value of all claims when claimed"
        />
        <SummaryStat
          label="P&L (Converted − Current)"
          value={formatUsd(business.pnl)}
          valueClass={pnlColor(business.pnl)}
          hint="Positive = claim-time value ahead of holding in kind"
        />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Total Tokens
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Lifetime reward quantities from all claims. Prices are fetched
              automatically — stablecoins are $1. Type a price to override a
              token manually; clear it to return to the auto price.
            </p>
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="text-xs text-[var(--muted)]">
              {priceLoading
                ? "Updating prices…"
                : priceUpdatedAt
                  ? `Updated ${formatUpdatedAt(priceUpdatedAt)}`
                  : "Prices not fetched yet"}
            </span>
            <button
              type="button"
              onClick={() => void refreshPrices()}
              disabled={priceLoading}
              className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>
        {priceError && (
          <p className="border-b border-[var(--border)] px-5 py-2 text-xs text-amber-400">
            ⚠ {priceError} Showing last known / manual prices; you can still
            enter prices by hand.
          </p>
        )}
        {business.tokenRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <h3 className="text-base font-semibold tracking-tight">
              No claims yet
            </h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
              Log fee claims to see your business P&amp;L breakdown.
            </p>
            <Link
              href="/claims"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
            >
              Go to Fee Claims
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Token</th>
                  <th className="px-4 py-3 text-right font-medium">Quantity</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Current Price (USD)
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    USDC Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {business.tokenRows.map((row) => (
                  <tr key={row.token}>
                    <td className="px-4 py-3 font-medium">{row.token}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatToken(row.quantity)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {row.token in settings.prices ? (
                          <span className="text-[10px] uppercase tracking-wide text-[var(--accent)]">
                            manual
                          </span>
                        ) : row.token in fetchedPrices ? (
                          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            auto
                          </span>
                        ) : null}
                        <input
                          key={`${row.token}-${row.price ?? "na"}`}
                          type="number"
                          step="any"
                          min="0"
                          aria-label={`Current price for ${row.token}`}
                          className={`${inputClass} w-32 text-right`}
                          placeholder="price"
                          defaultValue={row.price ?? ""}
                          onBlur={(e) => setPrice(row.token, e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.usdValue === null ? (
                        <span className="text-[var(--muted)]">
                          — enter price
                        </span>
                      ) : (
                        formatUsd(row.usdValue)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
                <tr className="font-semibold">
                  <td className="px-4 py-3">All Total</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUsd(business.allTotal)}
                    {business.unpricedTokens.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-amber-400">
                        excludes {business.unpricedTokens.join(", ")}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">
            Unconverted Holdings
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Reward tokens you claimed but have not cashed out to stablecoin —
            still exposed to price. Cost basis is the claim-time USD value;
            P&amp;L is what you&apos;ve gained or lost by holding instead of
            converting. Uses the same prices entered above.
          </p>
        </div>
        {holdings.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--muted)]">
            No unconverted holdings — every claim has been cashed out to
            stablecoin.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 border-b border-[var(--border)] px-5 py-4 sm:grid-cols-3">
              <SummaryStat
                label="Current Value"
                value={formatUsd(holdings.totalCurrentValue)}
              />
              <SummaryStat
                label="Cost Basis (Claim-Time)"
                value={formatUsd(holdings.totalCostBasis)}
              />
              <SummaryStat
                label="Unrealized P&L"
                value={formatUsd(holdings.totalPnl)}
                valueClass={pnlColor(holdings.totalPnl)}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Token</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Quantity Held
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Current Value
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Cost Basis
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Unrealized P&L
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {holdings.rows.map((row) => (
                    <tr key={row.token}>
                      <td className="px-4 py-3 font-medium">{row.token}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatToken(row.quantity)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.currentValue === null ? (
                          <span className="text-[var(--muted)]">
                            — enter price
                          </span>
                        ) : (
                          formatUsd(row.currentValue)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.costBasis === null ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          formatUsd(row.costBasis)
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          row.pnl === null ? "" : pnlColor(row.pnl)
                        }`}
                      >
                        {row.pnl === null ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          formatUsd(row.pnl)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
                  <tr className="font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatUsd(holdings.totalCurrentValue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatUsd(holdings.totalCostBasis)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${pnlColor(
                        holdings.totalPnl,
                      )}`}
                    >
                      {formatUsd(holdings.totalPnl)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {holdings.hasUnknownCostBasis && (
              <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-amber-400">
                ⚠ Some unconverted claims have no recorded USD value, so their
                cost basis is unknown and excluded from the totals above.
              </p>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">
            Yield Checkpoints
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Each checkpoint shows the claim USD value accumulated after that
            date — derived from claim dates, nothing hardcoded.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          {checkpointRows.length === 0 && (
            <p className="text-sm text-[var(--muted)]">
              No checkpoints yet. Add a date below to track per-period yield.
            </p>
          )}
          {checkpointRows.map((row) => (
            <div
              key={row.date}
              className="flex items-center justify-between gap-4 rounded-md border border-[var(--border)] bg-[var(--surface-2)]/40 px-4 py-3"
            >
              <span className="text-sm">
                Accumulated after{" "}
                <span className="font-medium">{formatDate(row.date)}</span>
              </span>
              <span className="flex items-center gap-4">
                <span className="text-sm font-semibold tabular-nums">
                  {formatUsd(row.accumulated)}
                </span>
                <button
                  type="button"
                  onClick={() => removeCheckpoint(row.date)}
                  className="text-xs text-[var(--muted)] hover:text-rose-400"
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <input
              type="date"
              aria-label="New checkpoint date"
              className={`${inputClass} w-44`}
              value={newCheckpoint}
              onChange={(e) => setNewCheckpoint(e.target.value)}
            />
            <button
              type="button"
              onClick={addCheckpoint}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90 disabled:opacity-50"
              disabled={newCheckpoint.trim() === ""}
            >
              Add Checkpoint
            </button>
          </div>
        </div>
      </div>

      {ledgerBlocks.length > 0 && (
        <div className="space-y-6">
          {ledgerBlocks.map((block) => (
            <div
              key={block.chain}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-tight">
                  {block.chain} Claims
                </h2>
              </div>
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
                        Token Rewards
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Quote Rewards
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        USD Value
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {block.claims.map((claim) => (
                      <tr key={claim.id}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {formatDate(claim.date)}
                        </td>
                        <td className="px-4 py-3">{claim.pair}</td>
                        <td className="px-4 py-3">{claim.platform}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {claim.token1Amount > 0
                            ? `${formatToken(claim.token1Amount)} ${claim.token1Symbol}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {claim.token2Amount > 0
                            ? `${formatToken(claim.token2Amount)} ${claim.token2Symbol}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {claim.stableAmount === null
                            ? "—"
                            : formatUsd(claim.stableAmount)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--muted)]">
                          {claimStatus(claim)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
                    <tr className="font-semibold">
                      <td className="px-4 py-3">TOTAL</td>
                      <td className="px-4 py-3" colSpan={4} />
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatUsd(block.usdTotal)}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface SummaryStatProps {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}

function SummaryStat({ label, value, valueClass, hint }: SummaryStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${valueClass ?? ""}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}
