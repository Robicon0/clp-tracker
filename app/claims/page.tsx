"use client";

import { useMemo, useState } from "react";
import { getClaims, getPositions, saveClaims } from "../../lib/storage";
import { useHydrated } from "../../lib/useHydrated";
import {
  calcDaysActive,
  calcFeeAPR,
  calcPortfolioSummary,
  getEffectiveDeposited,
  getEffectiveTotalFees,
} from "../../lib/calculations";
import {
  ClaimFormModal,
  persistNewClaim,
  persistUpdatedClaim,
  positionOptionLabel,
} from "../../components/ClaimFormModal";
import type { FeeClaim, Position } from "../../lib/types";

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

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; claim: FeeClaim };

interface FilterState {
  positionId: string;
  platform: string;
  chain: string;
}

const ALL = "__all__";
const EMPTY_FILTERS: FilterState = {
  positionId: ALL,
  platform: ALL,
  chain: ALL,
};

export default function ClaimsPage() {
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = () => {
    setClaims(getClaims());
    setPositions(getPositions());
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

  const filteredSorted = useMemo(() => {
    if (!hydrated) return [];
    const filtered = claims.filter((c) => {
      if (filters.positionId !== ALL && c.positionId !== filters.positionId) return false;
      if (filters.platform !== ALL && c.platform !== filters.platform) return false;
      if (filters.chain !== ALL && c.chain !== filters.chain) return false;
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

  const totals = useMemo(() => {
    let convertedCount = 0;
    let stableSum = 0;
    for (const c of claims) {
      if (c.convertedToStable) convertedCount += 1;
      // USD value counts regardless of conversion status (Invariant #10)
      if (c.stableAmount !== null && Number.isFinite(c.stableAmount)) {
        stableSum += c.stableAmount;
      }
    }
    return {
      total: claims.length,
      stableSum,
      converted: convertedCount,
    };
  }, [claims]);

  const positionById = useMemo(() => {
    const map = new Map<string, Position>();
    for (const p of positions) map.set(p.id, p);
    return map;
  }, [positions]);

  // Deposit-weighted average APR across positions that have at least one claim.
  // Reuses calcPortfolioSummary so this matches the Dashboard "Average Fee APR"
  // card exactly (Invariant #6) when both pages cover the same positions.
  const averagePositionApr = useMemo<number | null>(() => {
    if (claims.length === 0) return null;
    const claimedPositionIds = new Set(claims.map((c) => c.positionId));
    const claimedPositions = positions.filter((p) =>
      claimedPositionIds.has(p.id),
    );
    if (claimedPositions.length === 0) return null;
    return calcPortfolioSummary(claimedPositions, claims).averageAPR;
  }, [claims, positions]);

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
          label="Average Position APR"
          value={
            averagePositionApr === null
              ? "—"
              : formatPercent(averagePositionApr)
          }
        />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid grid-cols-1 gap-3 border-b border-[var(--border)] px-5 py-4 sm:grid-cols-3">
          <FilterSelect
            label="Position"
            value={filters.positionId}
            onChange={(v) =>
              setFilters((prev) => ({ ...prev, positionId: v }))
            }
            options={[
              { value: ALL, label: "All positions" },
              ...positions.map((p) => ({
                value: p.id,
                label: positionOptionLabel(p),
              })),
            ]}
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
}

function SummaryStat({ label, value }: SummaryStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
        {value}
      </div>
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
