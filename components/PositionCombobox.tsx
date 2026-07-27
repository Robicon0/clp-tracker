"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { positionOptionLabel } from "./ClaimFormModal";
import { normalizeChain } from "../lib/nameNormalization";
import type { Position } from "../lib/types";

// Searchable, chain-grouped position picker shared by the Fee Claims filter and
// the Add Transfer form. Type any of pair/chain/platform to filter live;
// positions are grouped by (normalized) chain and, within a chain, sorted most
// recent first. `allValue` (optional) adds a clearable "all" entry — the Fee
// Claims filter uses it; Add Transfer omits it so a real position is required.
export function PositionCombobox({
  positions,
  value,
  onChange,
  label = "Position",
  allValue,
  allLabel = "All positions",
  placeholder = "— Select position —",
}: {
  positions: Position[];
  value: string;
  onChange: (next: string) => void;
  label?: string;
  allValue?: string;
  allLabel?: string;
  placeholder?: string;
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

  const selectedLabel = (() => {
    if (allValue !== undefined && value === allValue) return allLabel;
    const p = positions.find((pos) => pos.id === value);
    if (p) return positionOptionLabel(p);
    return allValue !== undefined ? allLabel : placeholder;
  })();

  // Group by chain (chains alphabetical), most-recent-first within each group.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = positions.filter((p) => {
      if (q === "") return true;
      return `${p.pair} ${p.chain} ${p.protocol}`.toLowerCase().includes(q);
    });
    const byChain = new Map<string, Position[]>();
    for (const p of matches) {
      const chain = normalizeChain(p.chain) || "OTHER";
      const list = byChain.get(chain);
      if (list) list.push(p);
      else byChain.set(chain, [p]);
    }
    for (const list of byChain.values()) {
      list.sort(
        (a, b) =>
          (new Date(b.entryDatetime).getTime() || 0) -
          (new Date(a.entryDatetime).getTime() || 0),
      );
    }
    return [...byChain.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [positions, query]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const isPlaceholder =
    (allValue === undefined && value === "") ||
    (allValue !== undefined && value === allValue);

  return (
    <div className="space-y-1.5" ref={ref}>
      <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-left text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          <span
            className={`truncate ${
              isPlaceholder ? "text-[var(--muted)]" : "text-[var(--foreground)]"
            }`}
          >
            {selectedLabel}
          </span>
          <span className="shrink-0 text-[var(--muted)]">▾</span>
        </button>

        {open && (
          <div className="scrollbar-dark absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface)] shadow-xl">
            <div className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface)] p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pair, chain, or platform…"
                className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            {allValue !== undefined && (
              <button
                type="button"
                onClick={() => select(allValue)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)] ${
                  value === allValue
                    ? "text-[var(--accent)]"
                    : "text-[var(--foreground)]"
                }`}
              >
                {allLabel}
              </button>
            )}
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
