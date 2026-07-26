"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getClaims,
  getOutlierDismissals,
  getPositions,
  saveClaims,
  saveOutlierDismissals,
} from "../../lib/storage";
import { useHydrated } from "../../lib/useHydrated";
import {
  calcDaysActive,
  calcFeeAPR,
  calcPortfolioSummary,
  correctClaimSymbols,
  findClaimSymbolMismatches,
  getEffectiveDeposited,
  getEffectiveTotalFees,
  isUnvaluedConvertedClaim,
  summarizeClaimContamination,
  type ClaimContaminationRow,
  type ClaimSymbolMismatchRow,
} from "../../lib/calculations";
import {
  dismissalFor,
  findClaimAmountOutliers,
  type OutlierRow,
} from "../../lib/dataHealth";
import { OutlierBanner } from "../../components/OutlierBanner";
import {
  ClaimFormModal,
  persistNewClaim,
  persistUpdatedClaim,
  positionOptionLabel,
} from "../../components/ClaimFormModal";
import type { FeeClaim, OutlierDismissal, Position } from "../../lib/types";

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

function positionFeeAPR(position: Position, allClaims: FeeClaim[]): number {
  const days = calcDaysActive(position.entryDatetime, position.exitDatetime);
  const totalFees = getEffectiveTotalFees(position, allClaims);
  return calcFeeAPR(totalFees, getEffectiveDeposited(position), days);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateDDMMYYYY(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Flags claims whose stored token symbol contradicts their own pair, shows the
// per-token "X wrong is really Y" subtotal that inflates Business P&L, and
// offers a confirmed one-click bulk correction plus per-row Edit. Reports and
// corrects only on explicit user action — never silently.
function ClaimSymbolMismatchBanner({
  rows,
  contamination,
  onEdit,
  onFixAll,
}: {
  rows: ClaimSymbolMismatchRow[];
  contamination: ClaimContaminationRow[];
  onEdit: (claim: FeeClaim) => void;
  onFixAll: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      id="claim-symbol-issues"
      className="rounded-lg border border-red-500/50 bg-red-500/[0.07] px-5 py-4"
    >
      <h2 className="text-sm font-semibold text-red-300">
        {rows.length} {rows.length === 1 ? "claim has" : "claims have"} a token
        symbol that doesn&apos;t match its pair
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        These claims stored the wrong reward-token symbol (e.g. SOL logged
        against a SUI/USDC pair), which inflates that token&apos;s total on
        Business P&amp;L. Fixing them re-sums those totals correctly. Nothing
        changes until you confirm.
      </p>

      {contamination.length > 0 && (
        <div className="mt-3 rounded border border-red-500/30 bg-[var(--surface-2)]/40 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Mislabeled amounts
          </p>
          <ul className="mt-1.5 space-y-1">
            {contamination.map((c) => (
              <li
                key={`${c.wrongSymbol}->${c.correctSymbol}`}
                className="text-[12px] tabular-nums text-[var(--foreground)]"
              >
                <span className="font-medium text-red-300">
                  {formatToken(c.amount)} {c.wrongSymbol}
                </span>{" "}
                is actually{" "}
                <span className="font-medium text-emerald-300">
                  {c.correctSymbol}
                </span>{" "}
                <span className="text-[var(--muted)]">
                  ({c.claimCount} {c.claimCount === 1 ? "claim" : "claims"})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.claim.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border-strong)] bg-[var(--surface-2)]/40 px-3 py-2 text-[12px]"
          >
            <span className="font-medium text-[var(--foreground)]">
              {formatDateDDMMYYYY(r.claim.date)} · {r.claim.pair}
            </span>
            <span className="tabular-nums text-[var(--muted)]">
              {r.baseMismatch && (
                <>
                  <span className="font-medium text-red-300">{r.baseSymbol}</span>
                  {r.pairBase && <> → {r.pairBase}</>}
                </>
              )}
              {r.baseMismatch && r.quoteMismatch && " · "}
              {r.quoteMismatch && (
                <>
                  <span className="font-medium text-red-300">{r.quoteSymbol}</span>
                  {r.pairQuote && <> → {r.pairQuote}</>}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => onEdit(r.claim)}
              className="rounded-md border border-red-500/50 px-2.5 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/10"
            >
              Edit
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[12px] text-red-300">
              Rewrite symbols on {rows.length}{" "}
              {rows.length === 1 ? "claim" : "claims"}?
            </span>
            <button
              type="button"
              onClick={() => {
                onFixAll();
                setConfirming(false);
              }}
              className="rounded-md bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-500"
            >
              Yes, fix all
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-500/50 px-3 py-1.5 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-500/10"
          >
            Fix all {rows.length} {rows.length === 1 ? "claim" : "claims"}
          </button>
        )}
      </div>
    </div>
  );
}

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; claim: FeeClaim };

interface FilterState {
  positionId: string;
  platform: string;
  chain: string;
  // When true, show only claims marked converted with no saved USD value.
  needsValueOnly: boolean;
}

const ALL = "__all__";
const EMPTY_FILTERS: FilterState = {
  positionId: ALL,
  platform: ALL,
  chain: ALL,
  needsValueOnly: false,
};

export default function ClaimsPage() {
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const [dismissals, setDismissals] = useState<OutlierDismissal[]>([]);

  const refresh = () => {
    setClaims(getClaims());
    setPositions(getPositions());
    setDismissals(getOutlierDismissals());
  };

  const hydrated = useHydrated(refresh);

  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of claims) if (c.platform) set.add(c.platform);
    return Array.from(set).sort();
  }, [claims]);

  const chainOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of claims) if (c.chain) set.add(c.chain);
    return Array.from(set).sort();
  }, [claims]);

  const needsValueCount = useMemo(
    () => claims.filter(isUnvaluedConvertedClaim).length,
    [claims],
  );

  // Claims whose stored token symbol contradicts their own pair (the SUI→SOL
  // contamination). These inflate the wrong token's Business P&L total until
  // corrected, and are invisible to the position-level detector.
  const claimMismatches = useMemo(
    () => (hydrated ? findClaimSymbolMismatches(claims) : []),
    [hydrated, claims],
  );
  const contamination = useMemo(
    () => summarizeClaimContamination(claimMismatches),
    [claimMismatches],
  );
  // Unusual-amount outliers: claims 10× outside their position's usual range.
  const claimOutliers = useMemo(
    () =>
      hydrated ? findClaimAmountOutliers(claims, positions, dismissals) : [],
    [hydrated, claims, positions, dismissals],
  );

  const handleConfirmOutlier = (row: OutlierRow) => {
    saveOutlierDismissals([...getOutlierDismissals(), dismissalFor(row)]);
    setDismissals(getOutlierDismissals());
  };

  const filteredSorted = useMemo(() => {
    if (!hydrated) return [];
    const filtered = claims.filter((c) => {
      if (filters.positionId !== ALL && c.positionId !== filters.positionId) return false;
      if (filters.platform !== ALL && c.platform !== filters.platform) return false;
      if (filters.chain !== ALL && c.chain !== filters.chain) return false;
      if (filters.needsValueOnly && !isUnvaluedConvertedClaim(c)) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      const safeA = Number.isFinite(ta) ? ta : 0;
      const safeB = Number.isFinite(tb) ? tb : 0;
      return safeB - safeA;
    });
  }, [hydrated, claims, filters]);

  // Summary cards describe the same claims the table shows, so they read from
  // the filtered set — not the raw list. Computing over all claims while the
  // table filtered was the recurring "cards ignore the filter" bug already
  // fixed on Dashboard (7ae0e50) and Pool P&L (741ac8a).
  const totals = useMemo(() => {
    let convertedCount = 0;
    let stableSum = 0;
    for (const c of filteredSorted) {
      if (c.convertedToStable) convertedCount += 1;
      // USD value counts regardless of conversion status (Invariant #10)
      if (c.stableAmount !== null && Number.isFinite(c.stableAmount)) {
        stableSum += c.stableAmount;
      }
    }
    return {
      total: filteredSorted.length,
      stableSum,
      converted: convertedCount,
    };
  }, [filteredSorted]);

  const positionById = useMemo(() => {
    const map = new Map<string, Position>();
    for (const p of positions) map.set(p.id, p);
    return map;
  }, [positions]);

  // Deposit-weighted average APR across the positions represented in the
  // FILTERED claims, so this card follows the filters like the other three.
  // The APR uses the full claim list for each included position's fee total
  // (getEffectiveTotalFees inside calcPortfolioSummary) — a position's APR is
  // a property of the position, not of a claim subset, so it must not be
  // computed from a sliced fee history (Invariant #10). The filter decides
  // WHICH positions are in scope; each position's APR stays whole.
  const averagePositionApr = useMemo<number | null>(() => {
    if (filteredSorted.length === 0) return null;
    const claimedPositionIds = new Set(
      filteredSorted.map((c) => c.positionId),
    );
    const claimedPositions = positions.filter((p) =>
      claimedPositionIds.has(p.id),
    );
    if (claimedPositions.length === 0) return null;
    return calcPortfolioSummary(claimedPositions, claims).averageAPR;
  }, [filteredSorted, positions, claims]);

  const handleAdd = (claim: FeeClaim) => {
    persistNewClaim(claim);
    refresh();
    setModal({ kind: "none" });
  };

  const handleEdit = (claim: FeeClaim) => {
    persistUpdatedClaim(claim);
    refresh();
    setModal({ kind: "none" });
  };

  const handleDelete = (id: string) => {
    saveClaims(getClaims().filter((c) => c.id !== id));
    refresh();
    setPendingDelete(null);
  };

  // One-click bulk correction: rewrite each flagged claim's mismatched symbol
  // to its pair-derived value, through the shared persist path so transfers
  // stay reconciled (Invariant #10). User-triggered and confirmed — never
  // silent. Fixing the symbols re-sums the Business P&L totals correctly.
  const handleFixAllSymbols = (rows: ClaimSymbolMismatchRow[]) => {
    for (const row of rows) {
      persistUpdatedClaim(correctClaimSymbols(row));
    }
    refresh();
  };

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fee Claims</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Log every fee claim from your LP positions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: "add" })}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
        >
          Add Claim
        </button>
      </header>

      {claimMismatches.length > 0 && (
        <ClaimSymbolMismatchBanner
          rows={claimMismatches}
          contamination={contamination}
          onEdit={(claim) => setModal({ kind: "edit", claim })}
          onFixAll={() => handleFixAllSymbols(claimMismatches)}
        />
      )}

      <OutlierBanner
        id="claim-outliers"
        rows={claimOutliers}
        noun="claim"
        onEdit={(row) => row.claim && setModal({ kind: "edit", claim: row.claim })}
        onConfirm={handleConfirmOutlier}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="Total Claims" value={String(totals.total)} />
        <SummaryStat
          label="Total Fees Earned (USD)"
          value={formatUsd(totals.stableSum)}
        />
        <SummaryStat
          label="Total Converted to Stable"
          value={`${totals.converted} / ${totals.total}`}
        />
        <SummaryStat
          label="Average Position APR (Claimed)"
          value={
            averagePositionApr === null
              ? "—"
              : formatPercent(averagePositionApr)
          }
          hint="Deposit-weighted across all positions with claims here — active AND closed. The Dashboard's Average Fee APR is active-only, so this runs higher."
        />
      </div>

      {needsValueCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-5 py-4">
          <div>
            <p className="text-[13px] font-medium text-amber-300">
              {needsValueCount}{" "}
              {needsValueCount === 1 ? "claim needs" : "claims need"} a USD value
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Marked converted to stablecoin but saved with no USD value, so
              they count as $0 toward Overall P&amp;L. Open each and add the
              value it converted to.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                needsValueOnly: !prev.needsValueOnly,
              }))
            }
            className="rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/10"
          >
            {filters.needsValueOnly ? "Show all claims" : "Show only these"}
          </button>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {filters.needsValueOnly && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-amber-500/[0.04] px-5 py-2.5">
            <span className="text-[11px] font-medium text-amber-300">
              Showing only claims that need a USD value
            </span>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({ ...prev, needsValueOnly: false }))
              }
              className="text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            >
              Clear
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 border-b border-[var(--border)] px-5 py-4 sm:grid-cols-3">
          <PositionCombobox
            positions={positions}
            value={filters.positionId}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, positionId: v }))
            }
          />
          <FilterSelect
            label="Platform"
            value={filters.platform}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, platform: v }))
            }
            options={[
              { value: ALL, label: "All platforms" },
              ...platformOptions.map((p) => ({ value: p, label: p })),
            ]}
          />
          <FilterSelect
            label="Chain"
            value={filters.chain}
            onChange={(v) => setFilters((prev) => ({ ...prev, chain: v }))}
            options={[
              { value: ALL, label: "All chains" },
              ...chainOptions.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>

        {filteredSorted.length === 0 ? (
          claims.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <EmptyIcon />
              <h3 className="mt-3 text-base font-semibold tracking-tight text-[var(--foreground)]">
                No fee claims yet
              </h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
                Start by adding your first fee claim after claiming from your LP
                position.
              </p>
              <button
                type="button"
                onClick={() => setModal({ kind: "add" })}
                className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
              >
                Add Claim
              </button>
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
              No claims match the current filters.
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Pair</th>
                  <th className="px-4 py-3 text-left font-medium">Platform</th>
                  <th className="px-4 py-3 text-left font-medium">Chain</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Position Fee APR
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Token 1</th>
                  <th className="px-4 py-3 text-right font-medium">Token 2</th>
                  <th className="px-4 py-3 text-left font-medium">Converted</th>
                  <th className="px-4 py-3 text-right font-medium">
                    USD Value
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Tx</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredSorted.map((claim) => {
                  const parentPosition = positionById.get(claim.positionId);
                  const positionApr = parentPosition
                    ? formatPercent(positionFeeAPR(parentPosition, claims))
                    : "—";
                  return (
                  <tr
                    key={claim.id}
                    className="transition-colors hover:bg-[var(--surface-2)]/60"
                  >
                    <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                      {formatDateDDMMYYYY(claim.date)}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                      {claim.pair}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {claim.platform}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {claim.chain}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {positionApr}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatToken(claim.token1Amount)}{" "}
                      <span className="text-[var(--muted)]">
                        {claim.token1Symbol}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatToken(claim.token2Amount)}{" "}
                      <span className="text-[var(--muted)]">
                        {claim.token2Symbol}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {claim.convertedToStable
                        ? `Yes — ${claim.stableSymbol ?? ""}`.trim()
                        : "No"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {claim.stableAmount !== null
                        ? formatUsd(claim.stableAmount)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      <TxCell value={claim.txId ?? null} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {pendingDelete === claim.id ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-[var(--muted)]">
                            Delete this claim?
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDelete(claim.id)}
                            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => setModal({ kind: "edit", claim })}
                            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(claim.id)}
                            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.kind === "add" && (
        <ClaimFormModal
          mode="add"
          positions={positions}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={handleAdd}
        />
      )}
      {modal.kind === "edit" && (
        <ClaimFormModal
          mode="edit"
          claim={modal.claim}
          positions={positions}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={handleEdit}
        />
      )}
    </section>
  );
}

interface SummaryStatProps {
  label: string;
  value: string;
  hint?: string;
}

function SummaryStat({ label, value, hint }: SummaryStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
        {value}
      </div>
      {hint && <p className="mt-2 text-[11px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

interface TxCellProps {
  value: string | null;
}

function TxCell({ value }: TxCellProps) {
  if (!value) return <span>—</span>;
  const isUrl = /^https?:\/\//i.test(value);
  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        Open ↗
      </a>
    );
  }
  const display = value.length > 8 ? `${value.slice(0, 8)}…` : value;
  return <span className="font-mono text-xs" title={value}>{display}</span>;
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] [color-scheme:dark] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Searchable, chain-grouped position picker (Part 2). Replaces a ~129-option
// <select>. Type any of pair/chain/platform to filter live; "All positions"
// clears. Closed positions keep the "closed" suffix from positionOptionLabel.
function PositionCombobox({
  positions,
  value,
  onChange,
}: {
  positions: Position[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedLabel =
    value === ALL
      ? "All positions"
      : (() => {
          const p = positions.find((pos) => pos.id === value);
          return p ? positionOptionLabel(p) : "All positions";
        })();

  // Group filtered positions by chain, chains sorted alphabetically.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = positions.filter((p) => {
      if (q === "") return true;
      return `${p.pair} ${p.chain} ${p.protocol}`.toLowerCase().includes(q);
    });
    const byChain = new Map<string, Position[]>();
    for (const p of matches) {
      const chain = p.chain.trim().toUpperCase() || "OTHER";
      const list = byChain.get(chain);
      if (list) list.push(p);
      else byChain.set(chain, [p]);
    }
    return [...byChain.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [positions, query]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="space-y-1.5" ref={ref}>
      <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Position
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-left text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          <span className="truncate">{selectedLabel}</span>
          <span className="shrink-0 text-[var(--muted)]">▾</span>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface)] shadow-xl">
            <div className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface)] p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pair, chain, or platform…"
                className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => select(ALL)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)] ${
                value === ALL ? "text-[var(--accent)]" : "text-[var(--foreground)]"
              }`}
            >
              All positions
            </button>
            {groups.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-[var(--muted)]">
                No positions match “{query}”.
              </div>
            ) : (
              groups.map(([chain, list]) => (
                <div key={chain}>
                  <div className="bg-[var(--surface-2)]/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {chain}
                  </div>
                  {list.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => select(p.id)}
                      className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-2)] ${
                        value === p.id
                          ? "text-[var(--accent)]"
                          : "text-[var(--foreground)]"
                      }`}
                    >
                      {positionOptionLabel(p)}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
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
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 10h8M8 14h8M8 18h5" strokeLinecap="round" />
    </svg>
  );
}
