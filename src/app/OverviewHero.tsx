"use client";
// The CEO's two numbers (Mission Control kickoff, 2026-10-03): daily sales and daily
// customers, switchable by marketplace and category. Default (no filter) renders the
// exact figures the Overview page already fetched — zero extra work. Any filter switches
// to order-level math over `orders`/`cmpOrders`, which the page fetched once alongside the
// rest of its data (see page.tsx) — no client-side network calls.
//
// 2026-10-03 redesign: Ryan found the native <select> filters generic and wanted the
// page to lead with essentials. The filter is now a sentence you edit in place ("Showing
// [x] in [y]") instead of a form, and the hero numbers drop the card chrome entirely —
// on this page they ARE the content, not one card among several. The "at a glance" row
// (OverviewGlance.tsx) replaces the old three summary cards and shares this same filter
// state so it personalizes along with the hero.
//
// Scope note: a category filter narrows the two hero numbers but NOT the trend sparkline
// below them (recomputing a 30-day category breakdown would mean fetching every day's
// orders). The caption under the chart says so when a category is selected.
import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { OverviewGlance } from "./OverviewGlance";
import { matches, type OrderLike } from "./_lib/overview-filters";
import { formatDay, formatInt, formatMoneyCompact, pctChange } from "./_lib/format";
import type { ChannelId, PulseTotals } from "./_lib/types";

export type { OrderLike };
type ChannelSeriesPoint = { channelId: ChannelId; label: string; revenueCents: (number | null)[] };
type Changes = { revenue: number | null; customers: number | null; orders: number | null };

type OverviewHeroProps = {
  date: string;
  cmpDate: string | null;
  channelOptions: { id: ChannelId; label: string }[];
  totals: PulseTotals;
  compareChanges: Changes | null;
  orders: OrderLike[];
  cmpOrders: OrderLike[] | null;
  allDailyTotals: number[];
  channelSeries: ChannelSeriesPoint[];
};

function aggregateTotals(rows: OrderLike[], channelLabel: string | "all", category: string | "all"): PulseTotals {
  const filtered = rows.filter(o => matches(o, channelLabel, category));
  const live = filtered.filter(o => o.status !== "cancelled"); // revenue sums every row (net already reflects refunds); orders/customers exclude cancellations, same as the pulse view
  return {
    revenueCents: filtered.reduce((a, o) => a + o.netCents, 0),
    customers: new Set(live.map(o => `${o.channelLabel}:${o.orderId}`)).size,
    orders: live.length,
  };
}

export function OverviewHero({ date, cmpDate, channelOptions, totals, compareChanges, orders, cmpOrders, allDailyTotals, channelSeries }: OverviewHeroProps) {
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

  const trendValues = channel === "all"
    ? allDailyTotals
    : (channelSeries.find(s => s.channelId === channel)?.revenueCents.filter((v): v is number => v != null) ?? []);

  const comparedTo = cmpDate ? formatDay(cmpDate) : "prior week";
  const suffix = [channel !== "all" ? channelLabel : null, category !== "all" ? category : null].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-ink-2">
          Showing{" "}
          <FilterWord ariaLabel="Filter by marketplace" value={channel} onChange={setChannel}
            options={[{ id: "all" as const, label: "all marketplaces" }, ...channelOptions.map(c => ({ id: c.id, label: c.label }))]} />
          {" "}in{" "}
          <FilterWord ariaLabel="Filter by category" value={category} onChange={setCategory}
            options={[{ id: "all", label: "all categories" }, ...categories.map(c => ({ id: c, label: c }))]} />
        </p>

        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <HeroNumber label={suffix ? `Daily sales — ${suffix}` : "Daily sales"} value={formatMoneyCompact(current.revenueCents)}
            trace={`${formatInt(current.orders)} orders`} changePct={changes?.revenue ?? null} comparedTo={comparedTo} side="left" />
          <HeroNumber label={suffix ? `Daily customers — ${suffix}` : "Daily customers"} value={formatInt(current.customers)}
            trace="1 per transaction" changePct={changes?.customers ?? null} comparedTo={comparedTo} side="right" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Sparkline values={trendValues.length >= 2 ? trendValues : [0, 0]} height={40} />
        {category !== "all" && <p className="text-[12px] text-ink-3">Trend above reflects all categories — only the two numbers above are narrowed to &quot;{category}&quot;.</p>}
      </div>

      {noData
        ? <p className="text-[12.5px] text-ink-3">No orders in this slice on {formatDay(date)}.</p>
        : <OverviewGlance orders={orders} cmpOrders={cmpOrders} channel={channel} channelLabel={channelLabel} category={category} comparedTo={comparedTo} />}
    </div>
  );
}

function HeroNumber({ label, value, trace, changePct, comparedTo, side }: {
  label: string; value: string; trace: string; changePct: number | null; comparedTo: string; side: "left" | "right";
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <div className={`flex flex-col gap-1.5 ${side === "left" ? "pb-4 sm:pb-0 sm:pr-7" : "pt-4 sm:pt-0 sm:pl-7"}`}>
      <span className="text-[13px] font-medium text-ink-3">{label}</span>
      <span className="text-[50px] leading-none font-semibold tracking-[-0.03em] text-ink">{value}</span>
      <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
        {changePct == null ? <span className="rounded-full bg-muted-soft px-[7px] py-0.5 font-semibold">—</span> : (
          <span className={`rounded-full px-[7px] py-0.5 font-semibold ${up ? "bg-ok-soft text-ok" : "bg-muted-soft text-ink-2"}`}>
            {up ? "↑" : "↓"} {Math.abs(changePct).toFixed(1)}%
          </span>
        )}
        <span>vs {comparedTo} · {trace}</span>
      </span>
    </div>
  );
}

/** A filter rendered as an editable word in a sentence, not a form control: a dotted
 * underline that opens a small listbox below it, instead of a native select box. */
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
        className="border-b-[1.5px] border-dotted border-ink-3 font-semibold text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
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
