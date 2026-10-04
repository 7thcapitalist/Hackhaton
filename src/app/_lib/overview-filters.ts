// Shared aggregation helpers for the Overview page's marketplace/category
// personalization (OverviewHero.tsx + OverviewGlance.tsx). Pure functions over
// order rows the page already fetched — no DB access, so safe to import from
// client components. Revenue sums every row (net already reflects refunds);
// "live" rows exclude cancellations — the same convention as src/lib/views/pulse.ts.
import { pctChange } from "./format";

// grossCents (pre-fee/refund) rides alongside netCents only so OverviewHero can show
// "fees & refunds" (grossCents - netCents) as a substitute hero number when a filtered
// slice would otherwise show the same count twice (unique customers === orders) — see
// OverviewHero.tsx's aggregateTotals. Nothing else here uses it.
export type OrderLike = { channelLabel: string; category: string; netCents: number; grossCents: number; status: string; orderId: string; customerKey: string };

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

// previousCents/currentOrders/previousOrders ride alongside pct/currentCents so a mover card
// can explain *why* a number moved, not just restate the percentage — see biggestDriver below
// and MoverCard's order-count-vs-order-value fallback (round 7, Ryan: the explainer box was
// reciting its own methodology instead of saying what actually happened).
export type Mover = { key: string; pct: number; currentCents: number; previousCents: number; currentOrders: number; previousOrders: number };

/** Every bucket's revenue swing (up or down) between two bucket lists for the same keys,
 * ranked by magnitude — index 0 is the single biggest mover, the rest are runners-up (so
 * the "biggest mover" card can show more than one swing instead of a single sentence with
 * nothing else in the card). Keys with no comparable prior value are skipped (pctChange
 * already guards a zero or missing base). */
export function rankMovers(current: Bucket[], previous: Bucket[]): Mover[] {
  const prevByKey = new Map(previous.map(b => [b.key, b]));
  return current
    .map(b => {
      const prev = prevByKey.get(b.key) ?? null;
      const pct = pctChange(b.revenueCents, prev?.revenueCents ?? null);
      return pct == null ? null : {
        key: b.key, pct, currentCents: b.revenueCents,
        previousCents: prev?.revenueCents ?? 0, currentOrders: b.orders, previousOrders: prev?.orders ?? 0,
      };
    })
    .filter((m): m is Mover => m != null)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

/** The single biggest mover — rankMovers()[0]. */
export function biggestMover(current: Bucket[], previous: Bucket[]): Mover | null {
  return rankMovers(current, previous)[0] ?? null;
}

export type Driver = { label: string; deltaCents: number };

/** For one mover (a bucket's revenue swing along one dimension — a category, say), finds
 * which single sub-bucket along a *different* dimension (that category's revenue broken down
 * by marketplace) explains most of the swing, in dollar terms — so "Books fell 22%" can name
 * Amazon as the cause instead of just repeating the percentage (round 7, Ryan: "this was
 * mainly caused by a reduction in sales in Amazon" was the example he wanted, not a methodology
 * sentence). Ranked by raw cents delta, not pct — a tiny sub-bucket swinging 100% on a $4 base
 * isn't the real driver of a multi-hundred-dollar move. Returns null when there's nothing to
 * break down by (fewer than 2 sub-buckets across both periods, or no comparison data at all) —
 * callers fall back to an orders-vs-order-value explanation in that case. */
export function biggestDriver(
  current: OrderLike[], previous: OrderLike[] | null,
  filterKey: (o: OrderLike) => string, filterValue: string,
  breakdownKey: (o: OrderLike) => string,
): Driver | null {
  if (!previous) return null;
  const curBuckets = bucketBy(current.filter(o => filterKey(o) === filterValue), breakdownKey);
  const prevBuckets = bucketBy(previous.filter(o => filterKey(o) === filterValue), breakdownKey);
  const allKeys = new Set([...curBuckets.map(b => b.key), ...prevBuckets.map(b => b.key)]);
  if (allKeys.size < 2) return null;
  const curByKey = new Map(curBuckets.map(b => [b.key, b.revenueCents]));
  const prevByKey = new Map(prevBuckets.map(b => [b.key, b.revenueCents]));
  let best: Driver | null = null;
  for (const key of allKeys) {
    const deltaCents = (curByKey.get(key) ?? 0) - (prevByKey.get(key) ?? 0);
    if (!best || Math.abs(deltaCents) > Math.abs(best.deltaCents)) best = { label: key, deltaCents };
  }
  return best;
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
    // Real numbers already sitting in the fetched rows, unused until round 6: the single-
    // marketplace/single-category stat card (OverviewGlance's "Average order in X") was
    // consistently the shortest card in its row — it's a fixed ~4 lines next to a ranking or
    // mover card whose length varies with the day's data, so the grid's stretch left it
    // visibly empty in every filtered state, not just one. These give it two more real lines
    // instead of padding.
    customers: new Set(live.map(o => o.customerKey)).size,
    maxCents: live.reduce((a, o) => Math.max(a, o.netCents), 0),
  };
}
