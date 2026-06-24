"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getClaims,
  getPositions,
  saveClaims,
  savePositions,
} from "../../lib/storage";
import {
  calcDaysActive,
  calcFeeAPR,
  calcPortfolioSummary,
  calcTotalFees,
} from "../../lib/calculations";
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

function positionFeeAPR(position: Position): number {
  const days = calcDaysActive(position.entryDatetime, position.exitDatetime);
  const totalFees = calcTotalFees(position.claimed, position.newFees);
  return calcFeeAPR(totalFees, position.deposited, days);
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

function todayDateInput(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNum(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface ClaimFormState {
  positionId: string;
  date: string;
  currentPositionValue: string;
  txId: string;
  pair: string;
  platform: string;
  chain: string;
  token1Symbol: string;
  token1Amount: string;
  token2Symbol: string;
  token2Amount: string;
  convertedToStable: boolean;
  stableSymbol: string;
  stableAmount: string;
  notes: string;
}

const EMPTY_FORM: ClaimFormState = {
  positionId: "",
  date: "",
  currentPositionValue: "",
  txId: "",
  pair: "",
  platform: "",
  chain: "",
  token1Symbol: "",
  token1Amount: "",
  token2Symbol: "",
  token2Amount: "",
  convertedToStable: false,
  stableSymbol: "USDC",
  stableAmount: "",
  notes: "",
};

function claimToForm(c: FeeClaim): ClaimFormState {
  return {
    positionId: c.positionId,
    date: c.date.slice(0, 10),
    currentPositionValue:
      c.currentPositionValue === null || c.currentPositionValue === undefined
        ? ""
        : String(c.currentPositionValue),
    txId: c.txId ?? "",
    pair: c.pair,
    platform: c.platform,
    chain: c.chain,
    token1Symbol: c.token1Symbol,
    token1Amount: String(c.token1Amount),
    token2Symbol: c.token2Symbol,
    token2Amount: String(c.token2Amount),
    convertedToStable: c.convertedToStable,
    stableSymbol: c.stableSymbol ?? "USDC",
    stableAmount: c.stableAmount === null ? "" : String(c.stableAmount),
    notes: c.notes,
  };
}

function buildClaim(id: string, form: ClaimFormState): FeeClaim {
  return {
    id,
    positionId: form.positionId,
    date: form.date,
    pair: form.pair.trim().toUpperCase(),
    platform: form.platform.trim().toUpperCase(),
    chain: form.chain.trim().toUpperCase(),
    token1Symbol: form.token1Symbol.trim().toUpperCase(),
    token1Amount: num(form.token1Amount),
    token2Symbol: form.token2Symbol.trim().toUpperCase(),
    token2Amount: num(form.token2Amount),
    convertedToStable: form.convertedToStable,
    stableSymbol: form.convertedToStable
      ? form.stableSymbol.trim().toUpperCase() || null
      : null,
    stableAmount: form.convertedToStable
      ? optionalNum(form.stableAmount)
      : null,
    currentPositionValue: optionalNum(form.currentPositionValue),
    txId: form.txId.trim() === "" ? null : form.txId.trim(),
    notes: form.notes.trim().toUpperCase(),
  };
}

function applyPositionValueUpdate(claim: FeeClaim): void {
  if (claim.currentPositionValue === null || !claim.positionId) return;
  const positions = getPositions();
  let changed = false;
  const updated = positions.map((p) => {
    if (p.id === claim.positionId) {
      changed = true;
      return { ...p, currentBalance: claim.currentPositionValue ?? p.currentBalance };
    }
    return p;
  });
  if (changed) savePositions(updated);
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
  const [hydrated, setHydrated] = useState(false);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = () => {
    setClaims(getClaims());
    setPositions(getPositions());
  };

  useEffect(() => {
    refresh();
    setHydrated(true);
  }, []);

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
      if (c.convertedToStable) {
        convertedCount += 1;
        if (c.stableAmount !== null && Number.isFinite(c.stableAmount)) {
          stableSum += c.stableAmount;
        }
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
    return calcPortfolioSummary(claimedPositions).averageAPR;
  }, [claims, positions]);

  const handleAdd = (form: ClaimFormState) => {
    const claim = buildClaim(newId(), form);
    saveClaims([...getClaims(), claim]);
    applyPositionValueUpdate(claim);
    refresh();
    setModal({ kind: "none" });
  };

  const handleEdit = (target: FeeClaim, form: ClaimFormState) => {
    const updated = buildClaim(target.id, form);
    saveClaims(getClaims().map((c) => (c.id === target.id ? updated : c)));
    applyPositionValueUpdate(updated);
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
              ...positions.map((p) => ({ value: p.id, label: p.pair })),
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
                    Stable Amount
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Tx</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredSorted.map((claim) => {
                  const parentPosition = positionById.get(claim.positionId);
                  const positionApr = parentPosition
                    ? formatPercent(positionFeeAPR(parentPosition))
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
                      {claim.convertedToStable && claim.stableAmount !== null
                        ? `${formatToken(claim.stableAmount)} ${claim.stableSymbol ?? ""}`.trim()
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
          title="Add Claim"
          submitLabel="Add Claim"
          initial={{ ...EMPTY_FORM, date: todayDateInput() }}
          positions={positions}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={handleAdd}
        />
      )}
      {modal.kind === "edit" && (
        <ClaimFormModal
          title="Edit Claim"
          submitLabel="Save Changes"
          initial={claimToForm(modal.claim)}
          positions={positions}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={(form) => handleEdit(modal.claim, form)}
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

interface ModalShellProps {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}

function ModalShell({ title, onCancel, children }: ModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}

function Field({ label, htmlFor, children, hint }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 [color-scheme:dark] caret-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="px-5 py-5">
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

interface FormActionsProps {
  onCancel: () => void;
  submitLabel: string;
}

function FormActions({ onCancel, submitLabel }: FormActionsProps) {
  return (
    <div className="flex justify-end gap-2 px-5 py-4">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
      >
        {submitLabel}
      </button>
    </div>
  );
}

interface ClaimFormModalProps {
  title: string;
  submitLabel: string;
  initial: ClaimFormState;
  positions: Position[];
  onCancel: () => void;
  onSubmit: (form: ClaimFormState) => void;
}

const PRESET_STABLES = ["USDC", "USDT"] as const;

function ClaimFormModal({
  title,
  submitLabel,
  initial,
  positions,
  onCancel,
  onSubmit,
}: ClaimFormModalProps) {
  const [form, setForm] = useState<ClaimFormState>(initial);

  const set = <K extends keyof ClaimFormState>(
    key: K,
    value: ClaimFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const upper =
    (key: keyof ClaimFormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, e.target.value.toUpperCase() as ClaimFormState[typeof key]);

  const onPositionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setForm((prev) => {
      const next = { ...prev, positionId: id };
      const p = positions.find((pos) => pos.id === id);
      if (p) {
        next.pair = p.pair;
        next.platform = p.protocol;
        next.chain = p.chain;
        if (!prev.token1Symbol) next.token1Symbol = p.token1Symbol;
        if (!prev.token2Symbol) next.token2Symbol = p.token2Symbol;
      }
      return next;
    });
  };

  const stableMode: "USDC" | "USDT" | "OTHER" = (
    PRESET_STABLES as readonly string[]
  ).includes(form.stableSymbol)
    ? (form.stableSymbol as "USDC" | "USDT")
    : "OTHER";

  const onStableModeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as "USDC" | "USDT" | "OTHER";
    if (v === "OTHER") set("stableSymbol", "");
    else set("stableSymbol", v);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Claim Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Position" htmlFor="positionId">
              <select
                id="positionId"
                value={form.positionId}
                onChange={onPositionChange}
                className={inputClass}
              >
                <option value="">— Select position —</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pair} · {p.chain}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="date">
              <input
                id="date"
                type="date"
                required
                className={inputClass}
                style={{ colorScheme: "dark" }}
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field
              label="Current Position Value (USD)"
              htmlFor="currentPositionValue"
              hint="This will automatically update your position's current balance"
            >
              <input
                id="currentPositionValue"
                type="number"
                step="any"
                className={inputClass}
                placeholder="Current value of your LP position"
                value={form.currentPositionValue}
                onChange={(e) => set("currentPositionValue", e.target.value)}
              />
            </Field>
            <Field
              label="Transaction ID (optional)"
              htmlFor="txId"
              hint="From your blockchain explorer e.g. etherscan.io"
            >
              <input
                id="txId"
                className={inputClass}
                placeholder="Paste transaction hash or explorer URL"
                value={form.txId}
                onChange={(e) => set("txId", e.target.value)}
              />
            </Field>
            <Field label="Pair" htmlFor="pair">
              <input
                id="pair"
                required
                className={inputClass}
                placeholder="ETH/USDC (0.05%)"
                value={form.pair}
                onChange={upper("pair")}
              />
            </Field>
            <Field label="Platform" htmlFor="platform">
              <input
                id="platform"
                required
                className={inputClass}
                placeholder="Aerodrome"
                value={form.platform}
                onChange={upper("platform")}
              />
            </Field>
            <Field label="Chain" htmlFor="chain">
              <input
                id="chain"
                required
                className={inputClass}
                placeholder="ETH"
                value={form.chain}
                onChange={upper("chain")}
              />
            </Field>
          </div>
        </Section>

        <Section title="Token 1 Fees">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Token 1 Symbol" htmlFor="token1Symbol">
              <input
                id="token1Symbol"
                required
                className={inputClass}
                placeholder="ETH"
                value={form.token1Symbol}
                onChange={upper("token1Symbol")}
              />
            </Field>
            <Field label="Token 1 Amount" htmlFor="token1Amount">
              <input
                id="token1Amount"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.token1Amount}
                onChange={(e) => set("token1Amount", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Token 2 Fees">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Token 2 Symbol" htmlFor="token2Symbol">
              <input
                id="token2Symbol"
                required
                className={inputClass}
                placeholder="USDC"
                value={form.token2Symbol}
                onChange={upper("token2Symbol")}
              />
            </Field>
            <Field label="Token 2 Amount" htmlFor="token2Amount">
              <input
                id="token2Amount"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.token2Amount}
                onChange={(e) => set("token2Amount", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Conversion (optional)">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--muted)]">
                Converted to Stablecoin?
              </span>
              <div
                role="radiogroup"
                aria-label="Converted to Stablecoin?"
                className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.convertedToStable}
                  onClick={() => set("convertedToStable", true)}
                  className={`h-8 px-4 text-xs font-medium transition-colors ${
                    form.convertedToStable
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!form.convertedToStable}
                  onClick={() => set("convertedToStable", false)}
                  className={`h-8 px-4 text-xs font-medium border-l border-[var(--border-strong)] transition-colors ${
                    !form.convertedToStable
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
                  }`}
                >
                  No
                </button>
              </div>
            </div>

            {form.convertedToStable && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Stable Symbol" htmlFor="stableMode">
                  <div className="space-y-2">
                    <select
                      id="stableMode"
                      value={stableMode}
                      onChange={onStableModeChange}
                      className={inputClass}
                    >
                      <option value="USDC">USDC</option>
                      <option value="USDT">USDT</option>
                      <option value="OTHER">Other…</option>
                    </select>
                    {stableMode === "OTHER" && (
                      <input
                        aria-label="Custom stable symbol"
                        className={inputClass}
                        placeholder="DAI"
                        value={form.stableSymbol}
                        onChange={upper("stableSymbol")}
                      />
                    )}
                  </div>
                </Field>
                <Field label="Stable Amount" htmlFor="stableAmount">
                  <input
                    id="stableAmount"
                    type="number"
                    step="any"
                    required
                    className={inputClass}
                    value={form.stableAmount}
                    onChange={(e) => set("stableAmount", e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>
        </Section>

        <Section title="Notes">
          <textarea
            id="notes"
            rows={2}
            className={inputClass}
            value={form.notes}
            onChange={upper("notes")}
          />
        </Section>

        <FormActions onCancel={onCancel} submitLabel={submitLabel} />
      </form>
    </ModalShell>
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
