"use client";
// The CEO's two numbers (Mission Control kickoff, 2026-10-03): daily sales and daily
// customers, switchable by marketplace and category. Default (no filter) renders the
// exact figures the Overview page already fetched — zero extra work. Any filter switches
// to order-level math over `orders`/`cmpOrders`, which the page fetched once alongside the
// rest of its data (see page.tsx) — no client-side network calls.
//
// Scope note: a category filter narrows the two hero numbers but NOT the trend sparkline
// below them (recomputing a 30-day category breakdown would mean fetching every day's
// orders). The caption under the chart says so when a category is selected.
import { useMemo, useState } from "react";
import { HeroStat } from "@/components/HeroStat";
import { Sparkline } from "@/components/Sparkline";
import { formatDay, formatInt, formatMoneyCompact, pctChange } from "./_lib/format";
import type { ChannelId, PulseTotals } from "./_lib/types";

export type OrderLike = { channelLabel: string; category: string; netCents: number; status: string; orderId: string };
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

function matches(o: OrderLike, channelLabel: string | "all", category: string | "all") {
  return (channelLabel === "all" || o.channelLabel === channelLabel) && (category === "all" || o.category === category);
}

function aggregate(rows: OrderLike[], channelLabel: string | "all", category: string | "all"): PulseTotals {
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

  const categories = useMemo(() => [...new Set(orders.map(o => o.category))].sort(), [orders]);
  const channelLabel = channel === "all" ? "all" : channelOptions.find(c => c.id === channel)?.label ?? "all";
  const filtered = channel !== "all" || category !== "all";

  const current = filtered ? aggregate(orders, channelLabel, category) : totals;
  const matchedCount = filtered ? orders.filter(o => matches(o, channelLabel, category)).length : null;
  const noData = matchedCount === 0;

  const changes: Changes | null = !filtered
    ? compareChanges
    : !cmpOrders
      ? null
      : (() => {
          const base = aggregate(cmpOrders, channelLabel, category);
          return { revenue: pctChange(current.revenueCents, base.revenueCents), customers: pctChange(current.customers, base.customers), orders: pctChange(current.orders, base.orders) };
        })();

  const trendValues = channel === "all"
    ? allDailyTotals
    : (channelSeries.find(s => s.channelId === channel)?.revenueCents.filter((v): v is number => v != null) ?? []);

  const comparedTo = cmpDate ? formatDay(cmpDate) : "prior week";
  const suffix = [channel !== "all" ? channelLabel : null, category !== "all" ? category : null].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[12.5px] font-medium text-ink-3">Showing</span>
        <select aria-label="Filter by marketplace" value={channel} onChange={e => setChannel(e.target.value as ChannelId | "all")}
          className="h-8 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-accent-line focus-visible:outline-2 focus-visible:outline-accent">
          <option value="all">All marketplaces</option>
          {channelOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)}
          className="h-8 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-accent-line focus-visible:outline-2 focus-visible:outline-accent">
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HeroStat label={suffix ? `Daily sales — ${suffix}` : "Daily sales"} value={formatMoneyCompact(current.revenueCents)}
          traceLabel={`${formatInt(current.orders)} orders`} changePct={changes?.revenue ?? null} comparedTo={comparedTo} />
        <HeroStat label={suffix ? `Daily customers — ${suffix}` : "Daily customers"} value={formatInt(current.customers)}
          traceLabel="1 per transaction" changePct={changes?.customers ?? null} comparedTo={comparedTo} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Sparkline values={trendValues.length >= 2 ? trendValues : [0, 0]} height={48} />
        {category !== "all" && <p className="text-[12px] text-ink-3">Trend above reflects all categories — only the two numbers above are narrowed to &quot;{category}&quot;.</p>}
      </div>

      {noData && <p className="text-[12.5px] text-ink-3">No orders in this slice on {formatDay(date)}.</p>}
    </div>
  );
}
