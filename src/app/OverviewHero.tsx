"use client";
// The CEO's three numbers (Mission Control kickoff, 2026-10-03; orders promoted to its
// own number on 2026-10-03 evening): daily sales, daily customers, daily orders —
// switchable by marketplace and category. Default (no filter) renders the exact figures
// the Overview page already fetched — zero extra work. Any filter switches to
// order-level math over `orders`/`cmpOrders`, which the page fetched once alongside the
// rest of its data (see page.tsx) — no client-side network calls.
//
// 2026-10-03 redesign (two passes): Ryan found the native <select> filters generic and
// wanted the page to lead with essentials — hero dropped the card chrome, filters became
// an editable control, the old three summary cards became an adaptive "at a glance" row
// (OverviewGlance.tsx). Second pass: the trend sparkline felt like filler and got cut,
// orders got promoted from a hero subtext into its own number, and the filter control
// got a visible pill/icon treatment so it reads as interactive at a glance — a plain
// dotted underline wasn't enough of a signal.
import { useEffect, useRef, useState } from "react";
import { OverviewGlance } from "./OverviewGlance";
import { matches, type OrderLike } from "./_lib/overview-filters";
import { formatDay, formatInt, formatMoneyCompact, pctChange } from "./_lib/format";
import type { ChannelId, PulseTotals } from "./_lib/types";

export type { OrderLike };
type Changes = { revenue: number | null; customers: number | null; orders: number | null };

type OverviewHeroProps = {
  date: string;
  cmpDate: string | null;
  channelOptions: { id: ChannelId; label: string }[];
  totals: PulseTotals;
  compareChanges: Changes | null;
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
};

function aggregateTotals(rows: OrderLike[], channelLabel: string | "all", category: string | "all"): PulseTotals {
  const filtered = rows.filter(o => matches(o, channelLabel, category));
  const live = filtered.filter(o => o.status !== "cancelled"); // revenue sums every row (net already reflects refunds); orders/customers exclude cancellations, same as the pulse view
  return {
    revenueCents: filtered.reduce((a, o) => a + o.netCents, 0),
    customers: new Set(live.map(o => o.customerKey)).size,
    orders: live.length,
  };
}

export function OverviewHero({ date, cmpDate, channelOptions, totals, compareChanges, orders, cmpOrders }: OverviewHeroProps) {
  const [channel, setChannel] = useState<ChannelId | "all">("all");
  const [category, setCategory] = useState<string>("all");

  const categories = [...new Set(orders.map(o => o.category))].sort();
  const channelLabel = channel === "all" ? "all" : channelOptions.find(c => c.id === channel)?.label ?? "all";
  const filtered = channel !== "all" || category !== "all";

  const current = filtered ? aggregateTotals(orders, channelLabel, category) : totals;
  const matchedCount = filtered ? orders.filter(o => matches(o, channelLabel, category)).length : null;
  const noData = matchedCount === 0;

  const changes: Changes | null = !filtered
    ? compareChanges
    : !cmpOrders
      ? null
      : (() => {
          const base = aggregateTotals(cmpOrders, channelLabel, category);
          return { revenue: pctChange(current.revenueCents, base.revenueCents), customers: pctChange(current.customers, base.customers), orders: pctChange(current.orders, base.orders) };
        })();

  const comparedTo = cmpDate ? formatDay(cmpDate) : "prior week";
  const suffix = [channel !== "all" ? channelLabel : null, category !== "all" ? category : null].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 shadow-xs transition-colors hover:border-accent-line">
          <FilterIcon className="size-3.5 shrink-0 text-ink-3" />
          <p className="text-[14px] text-ink-2">
            Showing{" "}
            <FilterWord ariaLabel="Filter by marketplace" value={channel} onChange={setChannel}
              options={[{ id: "all" as const, label: "all marketplaces" }, ...channelOptions.map(c => ({ id: c.id, label: c.label }))]} />
            {" "}in{" "}
            <FilterWord ariaLabel="Filter by category" value={category} onChange={setCategory}
              options={[{ id: "all", label: "all categories" }, ...categories.map(c => ({ id: c, label: c }))]} />
          </p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <HeroNumber label={suffix ? `Daily sales — ${suffix}` : "Daily sales"} value={formatMoneyCompact(current.revenueCents)}
            changePct={changes?.revenue ?? null} comparedTo={comparedTo} side="first" />
          <HeroNumber label={suffix ? `Daily unique customers — ${suffix}` : "Daily unique customers"} value={formatInt(current.customers)}
            changePct={changes?.customers ?? null} comparedTo={comparedTo} side="middle" />
          <HeroNumber label={suffix ? `Daily orders — ${suffix}` : "Daily orders"} value={formatInt(current.orders)}
            changePct={changes?.orders ?? null} comparedTo={comparedTo} side="last" />
        </div>
      </div>

      {noData
        ? <p className="text-[12.5px] text-ink-3">No orders in this slice on {formatDay(date)}.</p>
        : <OverviewGlance orders={orders} cmpOrders={cmpOrders} channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />}
    </div>
  );
}

function HeroNumber({ label, value, changePct, comparedTo, side }: {
  label: string; value: string; changePct: number | null; comparedTo: string; side: "first" | "middle" | "last";
}) {
  const up = (changePct ?? 0) >= 0;
  const padding = side === "first" ? "pb-4 sm:pb-0 sm:pr-7" : side === "last" ? "pt-4 sm:pt-0 sm:pl-7" : "py-4 sm:py-0 sm:px-7";
  return (
    <div className={`flex flex-col gap-1.5 ${padding}`}>
      <span className="text-[13px] font-medium text-ink-3">{label}</span>
      <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink">{value}</span>
      <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
        {changePct == null ? <span className="rounded-full bg-muted-soft px-[7px] py-0.5 font-semibold">—</span> : (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>
            {up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%
          </span>
        )}
        <span>vs {comparedTo}</span>
      </span>
    </div>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2 4.5h12M4.5 8h7M7 11.5h2" />
    </svg>
  );
}

/** A filter rendered as an editable word in a sentence: a dotted underline that opens a
 * small listbox below it, instead of a native select box. Sits inside a bordered,
 * icon-led pill (see the wrapper above) so the whole control reads as interactive —
 * dotted text alone didn't signal that at a glance. */
function FilterWord<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = options.find(o => o.id === value)?.label ?? value;

  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="border-b-[1.5px] border-dotted border-accent font-semibold text-ink transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
        {current} <span aria-hidden className="text-ink-3">▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-label={ariaLabel} className="absolute left-0 top-[calc(100%+6px)] z-10 min-w-[190px] overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-md">
          {options.map(o => (
            <li key={o.id}>
              <button type="button" role="option" aria-selected={o.id === value} onClick={() => { onChange(o.id); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-[7px] text-left text-[13.5px] transition-colors hover:bg-surface-2 ${o.id === value ? "font-semibold text-ink" : "text-ink-2"}`}>
                {o.label}{o.id === value && <span aria-hidden className="text-accent">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
