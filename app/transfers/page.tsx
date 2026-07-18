"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getPositions,
  getSettings,
  getTransfers,
  saveTransfers,
} from "../../lib/storage";
import { useHydrated } from "../../lib/useHydrated";
import type { AppSettings, Position, Transfer } from "../../lib/types";

type TransferType = Transfer["transferType"];

const TYPE_LABELS: Record<TransferType, string> = {
  fees: "Fees",
  undeployed: "Undeployed Tokens",
  outOfRangeUpside: "Out of Range Upside",
};

const SHORT_TYPE_LABELS: Record<TransferType, string> = {
  fees: "Fees",
  undeployed: "Undeployed",
  outOfRangeUpside: "OOR Upside",
};

const TYPE_PILL: Record<TransferType, string> = {
  fees: "bg-blue-500/10 text-blue-300 ring-blue-500/30",
  undeployed: "bg-purple-500/10 text-purple-300 ring-purple-500/30",
  outOfRangeUpside: "bg-orange-500/10 text-orange-300 ring-orange-500/30",
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

interface TransferFormState {
  positionId: string;
  date: string;
  token: string;
  amount: string;
  platform: string;
  destination: string;
  transferType: TransferType;
  notes: string;
}

const EMPTY_FORM: TransferFormState = {
  positionId: "",
  date: "",
  token: "",
  amount: "",
  platform: "",
  destination: "",
  transferType: "fees",
  notes: "",
};

function transferToForm(t: Transfer): TransferFormState {
  return {
    positionId: t.positionId,
    date: t.date.slice(0, 10),
    token: t.token,
    amount: String(t.amount),
    platform: t.platform,
    destination: t.destination,
    transferType: t.transferType,
    notes: t.notes,
  };
}

function buildTransfer(id: string, form: TransferFormState): Transfer {
  return {
    id,
    positionId: form.positionId,
    date: form.date,
    token: form.token.trim().toUpperCase(),
    amount: num(form.amount),
    platform: form.platform.trim().toUpperCase(),
    destination: form.destination.trim().toUpperCase(),
    transferType: form.transferType,
    notes: form.notes.trim().toUpperCase(),
  };
}

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; transfer: Transfer };

type TypeFilter = "all" | TransferType;

export default function TransfersPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = () => {
    setSettings(getSettings());
    setTransfers(getTransfers());
    setPositions(getPositions());
  };

  const hydrated = useHydrated(refresh);

  const positionPairById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of positions) map.set(p.id, p.pair);
    return map;
  }, [positions]);

  const sortedFiltered = useMemo(() => {
    if (!hydrated) return [];
    const filtered = transfers.filter((t) =>
      typeFilter === "all" ? true : t.transferType === typeFilter,
    );
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [hydrated, transfers, typeFilter]);

  const totals = useMemo(() => {
    let amount = 0;
    const breakdown: Record<TransferType, number> = {
      fees: 0,
      undeployed: 0,
      outOfRangeUpside: 0,
    };
    for (const t of transfers) {
      amount += t.amount;
      breakdown[t.transferType] += 1;
    }
    return { count: transfers.length, amount, breakdown };
  }, [transfers]);

  // Per-token NET TOTAL (Σ amount moved out of that token), mirroring the
  // sheet's per-token blocks. Sorted by amount so the biggest movers lead.
  const byToken = useMemo(() => {
    const map = new Map<string, { token: string; count: number; amount: number }>();
    for (const t of transfers) {
      const token = t.token || "—";
      const row = map.get(token) ?? { token, count: 0, amount: 0 };
      row.count += 1;
      row.amount += t.amount;
      map.set(token, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [transfers]);

  // Per-destination breakdown (where the money went — RAKA, AAVE, …).
  // Transfers with no destination yet are grouped under "Unspecified".
  const byDestination = useMemo(() => {
    const map = new Map<
      string,
      { destination: string; count: number; amount: number }
    >();
    for (const t of transfers) {
      const destination = t.destination || "Unspecified";
      const row = map.get(destination) ?? { destination, count: 0, amount: 0 };
      row.count += 1;
      row.amount += t.amount;
      map.set(destination, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [transfers]);

  const handleAdd = (form: TransferFormState) => {
    saveTransfers([...getTransfers(), buildTransfer(newId(), form)]);
    refresh();
    setModal({ kind: "none" });
  };

  const handleEdit = (target: Transfer, form: TransferFormState) => {
    const updated = buildTransfer(target.id, form);
    saveTransfers(
      getTransfers().map((t) => (t.id === target.id ? updated : t)),
    );
    refresh();
    setModal({ kind: "none" });
  };

  const handleDelete = (id: string) => {
    saveTransfers(getTransfers().filter((t) => t.id !== id));
    refresh();
    setPendingDelete(null);
  };

  const transfersEnabled = !hydrated ? true : settings?.transfersEnabled !== false;

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Track where you send your claimed fees.
        </p>
      </header>

      {hydrated && !transfersEnabled ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            Transfers are disabled. Enable them in Settings to start tracking
            where you send your fees.
          </p>
          <Link
            href="/settings"
            className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
          >
            Go to Settings
          </Link>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setModal({ kind: "add" })}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
            >
              Add Transfer
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryStat label="Total Transfers" value={String(totals.count)} />
            <SummaryStat
              label="Transfers Net Total (USD)"
              value={formatUsd(totals.amount)}
            />
            <BreakdownStat breakdown={totals.breakdown} />
          </div>

          {byToken.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <GroupTable
                title="By Token"
                subtitle="Net total moved out per token."
                columnLabel="Token"
                rows={byToken.map((r) => ({
                  key: r.token,
                  label: r.token,
                  count: r.count,
                  amount: r.amount,
                }))}
                total={totals.amount}
              />
              <GroupTable
                title="By Destination"
                subtitle="Where the money went."
                columnLabel="Destination"
                rows={byDestination.map((r) => ({
                  key: r.destination,
                  label: r.destination,
                  count: r.count,
                  amount: r.amount,
                }))}
                total={totals.amount}
              />
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                All Transfers
              </h2>
              <TypeFilterToggle value={typeFilter} onChange={setTypeFilter} />
            </div>

            {sortedFiltered.length === 0 ? (
              transfers.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <EmptyIcon />
                  <h3 className="mt-3 text-base font-semibold tracking-tight text-[var(--foreground)]">
                    No transfers recorded
                  </h3>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
                    After claiming fees, record where you sent them.
                  </p>
                  <button
                    type="button"
                    onClick={() => setModal({ kind: "add" })}
                    className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--accent)]/90"
                  >
                    Add Transfer
                  </button>
                </div>
              ) : (
                <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                  No transfers match the current filter.
                </div>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Position
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Token</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Platform
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Destination
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Transfer Type
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Notes</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sortedFiltered.map((t) => (
                      <tr
                        key={t.id}
                        className="transition-colors hover:bg-[var(--surface-2)]/60"
                      >
                        <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                          {formatDateDDMMYYYY(t.date)}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                          {positionPairById.get(t.positionId) ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {t.token}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatToken(t.amount)}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {t.platform}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                          {t.destination || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <TypePill type={t.transferType} />
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)] max-w-xs truncate">
                          {t.notes || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {pendingDelete === t.id ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="text-xs text-[var(--muted)]">
                                Delete this transfer?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDelete(t.id)}
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
                                onClick={() =>
                                  setModal({ kind: "edit", transfer: t })
                                }
                                className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)]/70"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(t.id)}
                                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {modal.kind === "add" && (
            <TransferFormModal
              title="Add Transfer"
              submitLabel="Add Transfer"
              initial={{ ...EMPTY_FORM, date: todayDateInput() }}
              positions={positions}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={handleAdd}
            />
          )}
          {modal.kind === "edit" && (
            <TransferFormModal
              title="Edit Transfer"
              submitLabel="Save Changes"
              initial={transferToForm(modal.transfer)}
              positions={positions}
              onCancel={() => setModal({ kind: "none" })}
              onSubmit={(form) => handleEdit(modal.transfer, form)}
            />
          )}
        </>
      )}
    </section>
  );
}

interface GroupRow {
  key: string;
  label: string;
  count: number;
  amount: number;
}

interface GroupTableProps {
  title: string;
  subtitle: string;
  columnLabel: string;
  rows: GroupRow[];
  total: number;
}

function GroupTable({
  title,
  subtitle,
  columnLabel,
  rows,
  total,
}: GroupTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)] text-sm">
          <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{columnLabel}</th>
              <th className="px-4 py-3 text-right font-medium">Transfers</th>
              <th className="px-4 py-3 text-right font-medium">Net Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                  {row.count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatUsd(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-[var(--border-strong)] bg-[var(--surface-2)]/60">
            <tr className="font-semibold">
              <td className="px-4 py-3">Net Total</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right tabular-nums">
                {formatUsd(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
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

interface BreakdownStatProps {
  breakdown: Record<TransferType, number>;
}

function BreakdownStat({ breakdown }: BreakdownStatProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Breakdown by Type
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3">
        {(Object.keys(TYPE_LABELS) as TransferType[]).map((t) => (
          <div key={t} className="flex flex-col items-center">
            <div
              className={`flex h-6 w-full items-center justify-center rounded-full px-2 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ring-1 ring-inset ${TYPE_PILL[t]}`}
            >
              {SHORT_TYPE_LABELS[t]}
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums text-[var(--foreground)]">
              {breakdown[t]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TypePillProps {
  type: TransferType;
}

function TypePill({ type }: TypePillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ring-1 ring-inset ${TYPE_PILL[type]}`}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}

interface TypeFilterToggleProps {
  value: TypeFilter;
  onChange: (next: TypeFilter) => void;
}

function TypeFilterToggle({ value, onChange }: TypeFilterToggleProps) {
  const options: Array<{ value: TypeFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "fees", label: "Fees" },
    { value: "undeployed", label: "Undeployed Tokens" },
    { value: "outOfRangeUpside", label: "Out of Range Upside" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Filter by transfer type"
      className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`h-8 px-3 text-xs font-medium transition-colors ${
              idx > 0 ? "border-l border-[var(--border-strong)]" : ""
            } ${
              selected
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
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

interface TransferFormModalProps {
  title: string;
  submitLabel: string;
  initial: TransferFormState;
  positions: Position[];
  onCancel: () => void;
  onSubmit: (form: TransferFormState) => void;
}

function TransferFormModal({
  title,
  submitLabel,
  initial,
  positions,
  onCancel,
  onSubmit,
}: TransferFormModalProps) {
  const [form, setForm] = useState<TransferFormState>(initial);

  const set = <K extends keyof TransferFormState>(
    key: K,
    value: TransferFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const upper =
    (key: keyof TransferFormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, e.target.value.toUpperCase() as TransferFormState[typeof key]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className="divide-y divide-[var(--border)]">
        <Section title="Transfer Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Position" htmlFor="positionId">
              <select
                id="positionId"
                required
                value={form.positionId}
                onChange={(e) => set("positionId", e.target.value)}
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
            <Field label="Token" htmlFor="token">
              <input
                id="token"
                required
                className={inputClass}
                placeholder="ETH"
                value={form.token}
                onChange={upper("token")}
              />
            </Field>
            <Field label="Amount" htmlFor="amount">
              <input
                id="amount"
                type="number"
                step="any"
                required
                className={inputClass}
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
            <Field
              label="Platform (from)"
              htmlFor="platform"
              hint="Where the money came from."
            >
              <input
                id="platform"
                required
                className={inputClass}
                placeholder="AAVE"
                value={form.platform}
                onChange={upper("platform")}
              />
            </Field>
            <Field
              label="Destination (to)"
              htmlFor="destination"
              hint="Where you moved it — optional."
            >
              <input
                id="destination"
                className={inputClass}
                placeholder="RAKA"
                value={form.destination}
                onChange={upper("destination")}
              />
            </Field>
            <Field label="Transfer Type" htmlFor="transferType">
              <TypeSegmentedToggle
                value={form.transferType}
                onChange={(v) => set("transferType", v)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Notes" htmlFor="notes">
              <textarea
                id="notes"
                rows={2}
                className={inputClass}
                value={form.notes}
                onChange={upper("notes")}
              />
            </Field>
          </div>
        </Section>
        <FormActions onCancel={onCancel} submitLabel={submitLabel} />
      </form>
    </ModalShell>
  );
}

interface TypeSegmentedToggleProps {
  value: TransferType;
  onChange: (next: TransferType) => void;
}

function TypeSegmentedToggle({ value, onChange }: TypeSegmentedToggleProps) {
  const options: Array<{ value: TransferType; label: string }> = [
    { value: "fees", label: "Fees" },
    { value: "undeployed", label: "Undeployed Tokens" },
    { value: "outOfRangeUpside", label: "Out of Range Upside" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Transfer type"
      className="inline-flex overflow-hidden rounded-md border border-[var(--border-strong)]"
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`h-9 px-3 text-xs font-medium transition-colors ${
              idx > 0 ? "border-l border-[var(--border-strong)]" : ""
            } ${
              selected
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-2)]/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
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
      <path d="M5 7l7-4 7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
