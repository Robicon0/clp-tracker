"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getClaims,
  getPositions,
  getTransfers,
} from "../lib/storage";
import { getEffectiveDeposited, getEffectiveTotalFees } from "../lib/calculations";
import { useHydrated } from "../lib/useHydrated";
import type { FeeClaim, Position, Transfer } from "../lib/types";

interface NavItem {
  href: string;
  label: string;
  badgeKey?: "active" | "claims" | "transfers";
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/positions", label: "Positions", badgeKey: "active" },
  { href: "/claims", label: "Fee Claims", badgeKey: "claims" },
  { href: "/pool-pnl", label: "Pool P&L" },
  { href: "/business-pnl", label: "Business P&L" },
  { href: "/transfers", label: "Transfers", badgeKey: "transfers" },
  { href: "/total-pnl", label: "Total P&L" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface PortfolioStatus {
  state: "positive" | "negative" | "neutral";
  netPnl: number;
  hasData: boolean;
}

function computePortfolioStatus(
  positions: Position[],
  allClaims: FeeClaim[],
): PortfolioStatus {
  if (positions.length === 0) {
    return { state: "neutral", netPnl: 0, hasData: false };
  }
  // Mirrors the Total P&L page's Net P&L exactly (Invariant #6), which scopes
  // to open positions only — so this must filter identically or the two
  // numbers drift apart.
  let netPnl = 0;
  for (const p of positions.filter((pos) => pos.status === "active")) {
    netPnl += p.currentBalance - getEffectiveDeposited(p);
    netPnl += getEffectiveTotalFees(p, allClaims);
    if (p.shortTotal !== null && Number.isFinite(p.shortTotal)) {
      netPnl += p.shortTotal;
    }
  }
  const state =
    netPnl > 0 ? "positive" : netPnl < 0 ? "negative" : "neutral";
  return { state, netPnl, hasData: true };
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsd(value: number): string {
  return usdFormatter.format(Number.isFinite(value) ? value : 0);
}

export function Sidebar() {
  const pathname = usePathname();
  const [positions, setPositions] = useState<Position[]>([]);
  const [claims, setClaims] = useState<FeeClaim[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const load = () => {
    setPositions(getPositions());
    setClaims(getClaims());
    setTransfers(getTransfers());
  };

  const hydrated = useHydrated(load);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key === "clp_positions" ||
        e.key === "clp_claims" ||
        e.key === "clp_transfers"
      ) {
        load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Re-read on navigation so same-tab saves are reflected. Reads localStorage
  // (an external system) in response to a changed prop, the same "sync with
  // an external store" case the lint rule can't distinguish from a cascade.
  useEffect(() => {
    if (!hydrated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPositions(getPositions());
    setClaims(getClaims());
    setTransfers(getTransfers());
  }, [pathname, hydrated]);

  const counts = useMemo(
    () => ({
      active: positions.filter((p) => p.status === "active").length,
      claims: claims.length,
      transfers: transfers.length,
    }),
    [positions, claims, transfers],
  );

  const status = useMemo(
    () => (hydrated ? computePortfolioStatus(positions, claims) : null),
    [hydrated, positions, claims],
  );

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-[var(--border)] bg-[var(--surface)] md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 px-5 py-5 md:px-6 md:py-6">
        <div className="h-7 w-7 rounded-md bg-[var(--accent)]/15 ring-1 ring-inset ring-[var(--accent)]/30" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
            CLP Tracker
          </span>
          <span className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
            Liquidity desk
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-row gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3 md:pb-6">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const badge =
            hydrated && item.badgeKey ? counts[item.badgeKey] : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-[var(--surface-2)] text-[var(--foreground)] ring-1 ring-inset ring-[var(--border-strong)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)]/60 hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              <span>{item.label}</span>
              {badge !== null && badge > 0 && (
                <span
                  className={`min-w-5 rounded-full px-1.5 text-center text-[10px] font-semibold tabular-nums ${
                    active
                      ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                      : "bg-[var(--surface-2)] text-[var(--muted)]"
                  }`}
                  aria-label={`${badge} ${item.label.toLowerCase()}`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="hidden md:block">
        <PortfolioStatusBar status={status} />
        <div className="border-t border-[var(--border)] px-6 py-3 text-[11px] text-[var(--muted)]">
          Local data · v1.0
        </div>
      </div>
    </aside>
  );
}

interface PortfolioStatusBarProps {
  status: PortfolioStatus | null;
}

function PortfolioStatusBar({ status }: PortfolioStatusBarProps) {
  if (status === null) {
    return <div className="h-1 bg-[var(--surface-2)]" aria-hidden />;
  }
  const tone =
    status.state === "positive"
      ? {
          bar: "bg-emerald-500",
          text: "text-emerald-300",
          label: "Portfolio +",
        }
      : status.state === "negative"
        ? {
            bar: "bg-rose-500",
            text: "text-rose-300",
            label: "Portfolio -",
          }
        : {
            bar: "bg-[var(--surface-2)]",
            text: "text-[var(--muted)]",
            label: "No data",
          };
  return (
    <div>
      <div className={`h-1 ${tone.bar}`} aria-hidden />
      <div className="flex items-baseline justify-between border-t border-[var(--border)] px-6 py-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${tone.text}`}>
          {tone.label}
        </span>
        {status.hasData && (
          <span className={`text-[11px] tabular-nums ${tone.text}`}>
            {formatUsd(status.netPnl)}
          </span>
        )}
      </div>
    </div>
  );
}
