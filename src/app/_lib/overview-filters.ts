// Shared aggregation helpers for the Overview page's marketplace/category
// personalization (OverviewHero.tsx + OverviewGlance.tsx). Pure functions over
// order rows the page already fetched — no DB access, so safe to import from
// client components. Revenue sums every row (net already reflects refunds);
// "live" rows exclude cancellations — the same convention as src/lib/views/pulse.ts.
import { pctChange } from "./format";

export type OrderLike = { channelLabel: string; category: string; netCents: number; status: string; orderId: string; customerKey: string };

export function matches(o: OrderLike, channelLabel: string | "all", category: string | "all") {
  return (channelLabel === "all" || o.channelLabel === channelLabel) && (category === "all" || o.category === category);
}

export function liveRows(rows: OrderLike[]) {
  return rows.filter(o => o.status !== "cancelled");
}

export type Bucket = { key: string; revenueCents: number; orders: number };

/** Groups rows by `keyOf`, summing revenue over every row and counting only live
 * orders, sorted by revenue descending (so index 0 is always the top bucket). */
export function bucketBy(rows: OrderLike[], keyOf: (o: OrderLike) => string): Bucket[] {
  const revenue = new Map<string, number>();
  const orders = new Map<string, number>();
  for (const o of rows) revenue.set(keyOf(o), (revenue.get(keyOf(o)) ?? 0) + o.netCents);
  for (const o of liveRows(rows)) orders.set(keyOf(o), (orders.get(keyOf(o)) ?? 0) + 1);
  return [...revenue.entries()]
    .map(([key, revenueCents]) => ({ key, revenueCents, orders: orders.get(key) ?? 0 }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export type Mover = { key: string; pct: number; currentCents: number };

/** The bucket whose revenue swung most (up or down, by magnitude) between two
 * bucket lists for the same keys. Keys with no comparable prior value are
 * skipped (pctChange already guards a zero or missing base). */
export function biggestMover(current: Bucket[], previous: Bucket[]): Mover | null {
  const prevByKey = new Map(previous.map(b => [b.key, b.revenueCents]));
  const moves = current
    .map(b => ({ key: b.key, pct: pctChange(b.revenueCents, prevByKey.get(b.key) ?? null), currentCents: b.revenueCents }))
    .filter((m): m is Mover => m.pct != null);
  if (!moves.length) return null;
  return moves.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
}

export function sliceStats(rows: OrderLike[]) {
  const live = liveRows(rows);
  const cancelled = rows.length - live.length;
  const revenueCents = rows.reduce((a, o) => a + o.netCents, 0);
  const orders = live.length;
  return {
    revenueCents,
    orders,
    avgCents: orders ? Math.round(revenueCents / orders) : 0,
    cancelled,
    cancelRate: rows.length ? cancelled / rows.length : 0,
  };
}
