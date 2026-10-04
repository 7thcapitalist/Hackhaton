/**
 * Cost views: a P&L-style cost breakdown for a period (getCostBreakdown) and a
 * fully costed contribution margin by category or channel (getCostedMargin).
 *
 * contribution = net revenue (Σ orders.net_cents, already after per-order fees
 * and refunds) − shipping label cost (money_lines shipping_label + shipping_refund)
 * − other charges (non-order marketplace_fee / fulfillment_fee / adjustment lines)
 * − processing labor (labor_hours from timekeeping × LABOR_RATE_CENTS_PER_HOUR, an assumed loaded rate).
 * The all-channel contribution % equals the scorecard's net_margin_pct (same SQL
 * in ./cost-sql.ts, same formula in src/kpis). Overhead is not in the data.
 * Definitions: docs/kpi-definitions.md ("Costs"). Server-only.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { otherChargeSql } from "./cost-sql";
import { addDays, localToUtc, periodBounds } from "./dates";
import { laborRateCentsPerHour } from "./scorecard";
import type {
  ChannelId,
  CostBreakdownView,
  CostedMarginBy,
  CostedMarginRow,
  CostedMarginView,
  CostLineItem,
} from "./types";
import { cachedView } from "./cache";

const CHANNEL_IDS: ChannelId[] = ["shopgoodwill", "amazon", "ebay", "goodwill_books", "other"];
const UNCATEGORIZED = "Uncategorized";
const UNALLOCATED = "Unallocated";

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : null);
const n = (v: unknown) => Number(v ?? 0);

/**
 * Splits an integer `total` across keys in proportion to `weights` (largest
 * remainder), so the parts sum exactly to `total`. Empty map when no weight.
 */
export function allocate(total: number, weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const entries = [...weights].filter(([, w]) => w > 0);
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0 || total === 0) {
    if (sum > 0) for (const [k] of entries) out.set(k, 0);
    return out;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = entries.map(([k, w]) => ({ k, exact: (abs * w) / sum }));
  let given = 0;
  for (const r of raw) {
    const f = Math.floor(r.exact);
    out.set(r.k, f);
    given += f;
  }
  raw
    .sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.k.localeCompare(b.k))
    .slice(0, abs - given)
    .forEach((r) => out.set(r.k, out.get(r.k)! + 1));
  for (const [k, v] of out) out.set(k, v * sign);
  return out;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

function carrierOf(sourceId: string, memo: string | null): string {
  const m = (memo ?? "").trim();
  if (sourceId === "fedex") return "FedEx (invoice)";
  if (m.startsWith("EasyPost ")) return `EasyPost ${m.split(/\s+/)[1] ?? ""}`.trim();
  if (m.startsWith("Pitney Bowes ")) return `Pitney Bowes ${m.split(/\s+/)[2] ?? ""}`.trim();
  if (m.startsWith("OSM")) return "OSM";
  return sourceId;
}

const EXCLUDE_REASON: Record<string, string> = {
  postage_topup: "Cash movement: money moved into / out of the postage wallet; the labels bought with it are counted as shipping labels.",
  wallet_refund: "Cash movement (informational): the same label refund is counted from the shipment report.",
  payout: "Cash movement: marketplace payout to the bank; the underlying sales are in orders.",
  statement_payment: "Cash movement: statement payment to the bank; the underlying sales are in orders.",
  tax_withheld: "Tax collected/withheld by the marketplace: never revenue or cost.",
  sale: "Statement copy of order lines: already in orders (net revenue).",
  refund: "Statement copy of order refunds: already in orders (or a refund for an order outside this data).",
  order_linked_fee: "Per-order fee already in orders.fee_cents (statement repeats it).",
};
const excludeReason = (type: string) =>
  type.startsWith("bank_")
    ? "Cash movement: bank statement line (deposits, carrier/postage debits); costs are counted from the shipping and marketplace files instead."
    : (EXCLUDE_REASON[type] ?? "Not a P&L cost line; excluded.");

interface OrderAgg {
  channel: string;
  category: string;
  gross: number;
  shipping: number;
  refund: number;
  fee: number;
  tax: number;
  net: number;
  lines: number;
  paid: number;
}

interface CostingFacts {
  period: string;
  orders: OrderAgg[];
  shippingGroups: { source_id: string; amount_type: string; memo: string | null; lines: number; cents: number }[];
  /** Per linked label line: its cost split over the matched order lines. */
  linked: { id: string; cost: number; channel: string; category: string }[];
  other: { source_id: string; channel: string | null; amount_type: string; memo: string | null; lines: number; cents: number }[];
  excluded: { source_id: string; channel: string | null; amount_type: string; linked: number; lines: number; cents: number }[];
  hours: number;
  rate: number;
  laborCost: number;
  itemsByCategory: Map<string, number>;
  /** Channels whose order reports mostly carry no category. */
  uncategorizedChannels: string[];
  itemsByChannel: Map<string, number>;
  /** Items sold in the period: count and Σ days listed→sold, by category and by channel. */
  soldCategory: Map<string, { n: number; days: number }>;
  soldChannel: Map<string, { n: number; days: number }>;
  missing: string[];
}

async function loadCostingFacts(period: string): Promise<CostingFacts> {
  const db = getDb();
  const { start, end } = periodBounds(period);
  const startUtc = localToUtc(start, 0).toISOString();
  const endUtc = localToUtc(addDays(end, 1), 0).toISOString();
  const refHead = sql.raw(
    "trim(case when instr(m.reference, ' / ') > 0 then substr(m.reference, 1, instr(m.reference, ' / ') - 1) else m.reference end)",
  );

  const [orders, shippingGroups, linkedRaw, other, excluded, labor, itemsCat, itemsCh, itemsSold] = await Promise.all([
    db.all<OrderAgg>(sql`
      select channel, coalesce(category, ${UNCATEGORIZED}) as category,
             coalesce(sum(gross_cents), 0) as gross, coalesce(sum(shipping_cents), 0) as shipping,
             coalesce(sum(refund_cents), 0) as refund, coalesce(sum(fee_cents), 0) as fee,
             coalesce(sum(tax_cents), 0) as tax, coalesce(sum(net_cents), 0) as net,
             count(*) as lines, count(case when status = 'paid' then 1 end) as paid
      from orders where business_date between ${start} and ${end}
      group by 1, 2`),
    db.all<CostingFacts["shippingGroups"][number]>(sql`
      select m.source_id, m.amount_type, m.memo, count(*) as lines, coalesce(sum(m.amount_cents), 0) as cents
      from money_lines m
      where m.period = ${period} and m.amount_type in ('shipping_label', 'shipping_refund')
      group by 1, 2, 3`),
    db.all<{ id: string; amount: number; channel: string; category: string }>(sql`
      with l as (
        select m.id, m.amount_cents as amount, ${refHead} as head
        from money_lines m
        where m.period = ${period} and m.amount_type in ('shipping_label', 'shipping_refund') and m.reference is not null
          and ${refHead} in (select external_order_id from orders where external_order_id is not null)
      ),
      o as (
        select external_order_id, channel, coalesce(category, ${UNCATEGORIZED}) as category
        from orders where status != 'cancelled' and external_order_id in (select head from l)
      )
      select l.id, l.amount, o.channel, o.category from l join o on o.external_order_id = l.head`),
    db.all<CostingFacts["other"][number]>(sql`
      select m.source_id, m.channel, m.amount_type, m.memo, count(*) as lines, coalesce(sum(m.amount_cents), 0) as cents
      from money_lines m
      where m.period = ${period} and ${otherChargeSql}
      group by 1, 2, 3, 4`),
    db.all<CostingFacts["excluded"][number]>(sql`
      select m.source_id, m.channel, m.amount_type,
             case when m.amount_type in ('marketplace_fee', 'fulfillment_fee', 'adjustment') then 1 else 0 end as linked,
             count(*) as lines, coalesce(sum(m.amount_cents), 0) as cents
      from money_lines m
      where m.period = ${period}
        and m.amount_type not in ('shipping_label', 'shipping_refund')
        and not ${otherChargeSql}
      group by 1, 2, 3, 4`),
    db.all<{ hours: number }>(sql`
      select coalesce(sum(hours), 0) as hours from labor_hours where work_date between ${start} and ${end}`),
    db.all<{ k: string; ch: string | null; c: number }>(sql`
      select coalesce(category, ${UNCATEGORIZED}) as k, channel_source_id as ch, count(*) as c from items
      where listed_at >= ${startUtc} and listed_at < ${endUtc} group by 1, 2`),
    db.all<{ k: string | null; c: number }>(sql`
      select channel_source_id as k, count(*) as c from items
      where listed_at >= ${startUtc} and listed_at < ${endUtc} group by 1`),
    db.all<{ k: string; ch: string | null; c: number; days: number }>(sql`
      select coalesce(category, ${UNCATEGORIZED}) as k, channel_source_id as ch, count(*) as c,
             sum(julianday(sold_at) - julianday(listed_at)) as days
      from items
      where sold_at >= ${startUtc} and sold_at < ${endUtc} and listed_at is not null group by 1, 2`),
  ]);
  const soldCategory = new Map<string, { n: number; days: number }>();
  const soldChannel = new Map<string, { n: number; days: number }>();
  for (const r of itemsSold) {
    const put = (m: Map<string, { n: number; days: number }>, k: string) => {
      const e = m.get(k) ?? { n: 0, days: 0 };
      e.n += n(r.c);
      e.days += n(r.days);
      m.set(k, e);
    };
    put(soldCategory, r.k);
    if (r.ch && (CHANNEL_IDS as string[]).includes(r.ch)) put(soldChannel, r.ch);
  }

  // Split each linked label line's cost evenly over its matched order lines.
  const byLine = new Map<string, { amount: number; rows: { channel: string; category: string }[] }>();
  for (const r of linkedRaw) {
    const e = byLine.get(r.id) ?? { amount: n(r.amount), rows: [] };
    e.rows.push({ channel: r.channel, category: r.category });
    byLine.set(r.id, e);
  }
  const linked: CostingFacts["linked"] = [];
  for (const [id, e] of byLine) {
    const parts = allocate(-e.amount, new Map(e.rows.map((_, i) => [String(i), 1])));
    e.rows.forEach((row, i) => linked.push({ id, cost: parts.get(String(i)) ?? 0, ...row }));
  }

  const hours = n(labor[0]?.hours);
  const rate = laborRateCentsPerHour();
  const missing: string[] = [];
  if (!shippingGroups.length) missing.push("No shipping label files for this period: shipping label cost is missing (counted as $0).");
  if (hours <= 0) missing.push("No labor hours for this period: labor cost is missing (counted as $0).");
  if (!orders.length) missing.push("No orders in this period.");

  // Channels whose order reports mostly carry no category (e.g. Amazon, eBay):
  // their listings are weighted to "Uncategorized", where their revenue sits.
  const paidAll = new Map<string, number>();
  const paidUnc = new Map<string, number>();
  for (const o of orders) {
    add(paidAll, o.channel, n(o.paid));
    if (o.category === UNCATEGORIZED) add(paidUnc, o.channel, n(o.paid));
  }
  const uncategorizedChannels = [...paidAll].filter(([k, v]) => v > 0 && (paidUnc.get(k) ?? 0) / v > 0.5).map(([k]) => k);
  const itemsByCategory = new Map<string, number>();
  for (const r of itemsCat) add(itemsByCategory, r.ch && uncategorizedChannels.includes(r.ch) ? UNCATEGORIZED : r.k, n(r.c));

  return {
    period,
    orders: orders.map((o) => ({
      ...o,
      gross: n(o.gross), shipping: n(o.shipping), refund: n(o.refund), fee: n(o.fee), tax: n(o.tax),
      net: n(o.net), lines: n(o.lines), paid: n(o.paid),
    })),
    shippingGroups: shippingGroups.map((g) => ({ ...g, lines: n(g.lines), cents: n(g.cents) })),
    linked,
    other: other.map((g) => ({ ...g, lines: n(g.lines), cents: n(g.cents) })),
    excluded: excluded.map((g) => ({ ...g, linked: n(g.linked), lines: n(g.lines), cents: n(g.cents) })),
    hours,
    rate,
    laborCost: Math.round(hours * rate),
    itemsByCategory,
    uncategorizedChannels,
    soldCategory,
    soldChannel,
    itemsByChannel: new Map(
      itemsCh.filter((r) => r.k && (CHANNEL_IDS as string[]).includes(r.k)).map((r) => [r.k as string, n(r.c)]),
    ),
    missing,
  };
}

const METHOD_COMMON =
  "Contribution = net revenue (Σ orders.net_cents: gross + shipping charged − refunds − per-order marketplace fees; tax excluded) − shipping label cost (money_lines shipping_label + shipping_refund) − other charges (marketplace_fee / fulfillment_fee / adjustment money lines not tied to an order: ads, subscriptions, service fees, carrier adjustments) − processing labor (labor_hours from the timekeeping source × an assumed $18/h loaded rate). Donated goods have no cost of goods sold; overhead (rent, utilities, management) is not in the data.";

function methodFor(by: CostedMarginBy, f: CostingFacts): string {
  const rate = f.rate;
  const unc = f.uncategorizedChannels.join(", ");
  const labor =
    by === "category"
      ? `Labor is allocated by each category's share of items listed in the period (items.category).${unc ? ` The ${unc} order reports carry no category, so those channels' revenue is in "${UNCATEGORIZED}" and their listings' labor is weighted there too; "${UNCATEGORIZED}" is a mix of categories, not a category, so leave it out of category rankings.` : ""}`
      : "Labor is allocated by each channel's share of items listed in the period (items.channel_source_id; listings made through Upright, a multi-channel tool, are spread in the same proportions, so they do not change the shares; 'other' has no listings and gets no labor).";
  const other =
    by === "channel"
      ? "Other charges with a channel go to that channel; the rest (e.g. shipping-account adjustments) are allocated by share of paid order lines."
      : "Other charges are allocated by share of paid order lines.";
  return `${METHOD_COMMON} Shipping: a label whose reference's first token equals an orders.external_order_id is LINKED to that order's ${by}; unmatched label cost is ALLOCATED by share of paid order lines. ${other} ${labor} Labor rate $${(rate / 100).toFixed(2)}/h. If a group has no listings, nothing is allocated to it; if no group has listings, labor is allocated by paid order lines.`;
}

function computeGroups(f: CostingFacts, by: CostedMarginBy) {
  const keyOf = (o: { channel: string; category: string }) => (by === "channel" ? o.channel : o.category);
  const rev = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const o of f.orders) {
    add(rev, keyOf(o), o.net);
    add(paid, keyOf(o), o.paid);
  }

  // Shipping: linked + allocated remainder.
  const shippingTotal = -f.shippingGroups.reduce((s, g) => s + g.cents, 0);
  const shipLinked = new Map<string, number>();
  for (const l of f.linked) add(shipLinked, keyOf(l), l.cost);
  const linkedTotal = [...shipLinked.values()].reduce((s, v) => s + v, 0);
  const shipAlloc = allocate(shippingTotal - linkedTotal, paid);

  // Other charges.
  const otherTotal = -f.other.reduce((s, g) => s + g.cents, 0);
  const otherBy = new Map<string, number>();
  let unattributed = otherTotal;
  if (by === "channel") {
    for (const g of f.other) {
      if (g.channel && (CHANNEL_IDS as string[]).includes(g.channel)) {
        add(otherBy, g.channel, -g.cents);
        unattributed += g.cents;
      }
    }
  }
  for (const [k, v] of allocate(unattributed, paid)) add(otherBy, k, v);

  // Labor.
  const items = by === "channel" ? f.itemsByChannel : f.itemsByCategory;
  const sold = by === "channel" ? f.soldChannel : f.soldCategory;
  const laborWeights = [...items.values()].some((v) => v > 0) ? items : paid;
  const labor = allocate(f.laborCost, laborWeights);

  // Anything that could not be allocated (no weights at all) goes to "Unallocated".
  const sumMap = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  const unShip = shippingTotal - linkedTotal - sumMap(shipAlloc);
  const unOther = otherTotal - sumMap(otherBy);
  const unLabor = f.laborCost - sumMap(labor);
  if (unShip) add(shipAlloc, UNALLOCATED, unShip);
  if (unOther) add(otherBy, UNALLOCATED, unOther);
  if (unLabor) add(labor, UNALLOCATED, unLabor);

  const keys = new Set([...rev.keys(), ...shipLinked.keys(), ...shipAlloc.keys(), ...otherBy.keys(), ...labor.keys()]);
  const rows: CostedMarginRow[] = [...keys].map((group) => {
    const netRevenueCents = rev.get(group) ?? 0;
    const shippingLinkedCents = shipLinked.get(group) ?? 0;
    const shippingAllocatedCents = shipAlloc.get(group) ?? 0;
    const shippingCostCents = shippingLinkedCents + shippingAllocatedCents;
    const laborAllocatedCents = labor.get(group) ?? 0;
    const otherChargesCents = otherBy.get(group) ?? 0;
    const contributionCents = netRevenueCents - shippingCostCents - laborAllocatedCents - otherChargesCents;
    return {
      group,
      netRevenueCents,
      paidOrderLines: paid.get(group) ?? 0,
      itemsListed: items.get(group) ?? 0,
      itemsSold: sold.get(group)?.n ?? 0,
      avgDaysToSell: sold.get(group)?.n ? round1(sold.get(group)!.days / sold.get(group)!.n) : null,
      shippingLinkedCents,
      shippingAllocatedCents,
      shippingCostCents,
      laborAllocatedCents,
      otherChargesCents,
      contributionCents,
      contributionPct: pct(contributionCents, netRevenueCents),
      ...(group === UNCATEGORIZED && by === "category"
        ? { note: `Not a category: order lines with no category (the ${f.uncategorizedChannels.join(", ") || "marketplace"} reports carry none). Leave it out of category rankings.` }
        : group === UNALLOCATED
          ? { note: "Cost that could not be allocated (no listings or paid orders to weight it by)." }
          : {}),
    };
  });
  rows.sort((a, b) => b.contributionCents - a.contributionCents || a.group.localeCompare(b.group));

  const totals = rows.reduce<CostedMarginRow>(
    (t, r) => ({
      ...t,
      netRevenueCents: t.netRevenueCents + r.netRevenueCents,
      paidOrderLines: t.paidOrderLines + r.paidOrderLines,
      itemsListed: t.itemsListed + r.itemsListed,
      shippingLinkedCents: t.shippingLinkedCents + r.shippingLinkedCents,
      shippingAllocatedCents: t.shippingAllocatedCents + r.shippingAllocatedCents,
      shippingCostCents: t.shippingCostCents + r.shippingCostCents,
      laborAllocatedCents: t.laborAllocatedCents + r.laborAllocatedCents,
      otherChargesCents: t.otherChargesCents + r.otherChargesCents,
      contributionCents: t.contributionCents + r.contributionCents,
    }),
    {
      group: "Total", netRevenueCents: 0, paidOrderLines: 0, itemsListed: 0, shippingLinkedCents: 0,
      shippingAllocatedCents: 0, shippingCostCents: 0, laborAllocatedCents: 0, otherChargesCents: 0,
      contributionCents: 0, contributionPct: null, itemsSold: 0, avgDaysToSell: null,
    },
  );
  totals.contributionPct = pct(totals.contributionCents, totals.netRevenueCents);
  const allSold = [...sold.values()].reduce((s, e) => ({ n: s.n + e.n, days: s.days + e.days }), { n: 0, days: 0 });
  totals.itemsSold = allSold.n;
  totals.avgDaysToSell = allSold.n ? round1(allSold.days / allSold.n) : null;
  return { rows, totals };
}

/** Fully costed contribution margin per category or channel for a period (`YYYY-MM`). */
async function getCostedMarginUncached(opts: { period: string; by: CostedMarginBy }): Promise<CostedMarginView> {
  const f = await loadCostingFacts(opts.period);
  const { rows, totals } = computeGroups(f, opts.by);
  return {
    period: opts.period,
    by: opts.by,
    groups: rows,
    totals,
    method: methodFor(opts.by, f),
    laborSimulated: false,
    missing: f.missing,
  };
}

/** P&L-style cost breakdown for a period, optionally for one channel (costs then allocated). */
async function getCostBreakdownUncached(opts: { period: string; channel?: ChannelId | null }): Promise<CostBreakdownView> {
  const f = await loadCostingFacts(opts.period);
  const channel = opts.channel ?? null;
  const inScope = <T extends { channel: string | null }>(r: T) => channel === null || r.channel === channel;

  const ords = f.orders.filter(inScope);
  const sum = (k: keyof Omit<OrderAgg, "channel" | "category">) => ords.reduce((s, o) => s + o[k], 0);
  const revenue = {
    grossSalesCents: sum("gross"),
    shippingChargedCents: sum("shipping"),
    refundsCents: sum("refund"),
    marketplaceFeesCents: sum("fee"),
    netRevenueCents: sum("net"),
    orderLines: sum("lines"),
    paidOrderLines: sum("paid"),
  };

  const labelsCents = -f.shippingGroups.filter((g) => g.amount_type === "shipping_label").reduce((s, g) => s + g.cents, 0);
  const carrierRefundsCents = f.shippingGroups.filter((g) => g.amount_type === "shipping_refund").reduce((s, g) => s + g.cents, 0);
  const carriers = new Map<string, { cost: number; lines: number; refunds: number; source: string }>();
  for (const g of f.shippingGroups) {
    const k = carrierOf(g.source_id, g.memo);
    const c = carriers.get(k) ?? { cost: 0, lines: 0, refunds: 0, source: g.source_id };
    c.cost -= g.cents;
    if (g.amount_type === "shipping_label") c.lines += g.lines;
    else c.refunds += g.cents;
    carriers.set(k, c);
  }
  const byCarrier: CostLineItem[] = [...carriers]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([k, c]) => ({
      key: k,
      label: k,
      cents: c.cost,
      source: `money_lines shipping_label + shipping_refund (${c.source})`,
      lines: c.lines,
      ...(c.refunds ? { note: `net of $${(c.refunds / 100).toFixed(2)} carrier label refunds` } : {}),
    }));

  let shipping: CostBreakdownView["shippingLabels"];
  let laborCost = f.laborCost;
  let otherCharges: CostBreakdownView["otherCharges"];

  const otherLine = (g: CostingFacts["other"][number]): CostLineItem => ({
    key: `${g.source_id}:${g.amount_type}:${g.memo ?? ""}`,
    label: `${g.memo ?? g.amount_type}${g.channel ? ` (${g.channel})` : ""}`,
    cents: -g.cents,
    source: `money_lines ${g.amount_type} (${g.source_id})`,
    lines: g.lines,
  });

  if (channel === null) {
    shipping = { costCents: labelsCents - carrierRefundsCents, labelsCents, carrierRefundsCents, byCarrier, linkedCents: f.linked.reduce((s, l) => s + l.cost, 0), allocatedCents: 0 };
    const lines = f.other.map(otherLine).sort((a, b) => b.cents - a.cents);
    otherCharges = { costCents: lines.reduce((s, l) => s + l.cents, 0), lines };
  } else {
    const { rows } = computeGroups(f, "channel");
    const row = rows.find((r) => r.group === channel);
    shipping = {
      costCents: row?.shippingCostCents ?? 0,
      labelsCents: row?.shippingCostCents ?? 0,
      carrierRefundsCents: 0,
      byCarrier: [],
      linkedCents: row?.shippingLinkedCents ?? 0,
      allocatedCents: row?.shippingAllocatedCents ?? 0,
    };
    laborCost = row?.laborAllocatedCents ?? 0;
    const direct = f.other.filter((g) => g.channel === channel).map(otherLine);
    const directSum = direct.reduce((s, l) => s + l.cents, 0);
    const share = (row?.otherChargesCents ?? 0) - directSum;
    const lines = [...direct];
    if (share) lines.push({ key: "allocated", label: "Allocated share of charges with no channel (e.g. shipping-account adjustments)", cents: share, source: "allocation by paid order lines" });
    otherCharges = { costCents: row?.otherChargesCents ?? 0, lines };
  }

  const contributionCents = revenue.netRevenueCents - shipping.costCents - laborCost - otherCharges.costCents;
  const excludedLines = f.excluded
    .filter((g) => channel === null || g.channel === channel)
    .map((g) => {
      const type = g.linked ? "order_linked_fee" : g.amount_type;
      return {
        key: `${g.source_id}:${g.amount_type}`,
        label: `${g.amount_type} (${g.source_id})`,
        cents: g.cents,
        source: `money_lines ${g.amount_type} (${g.source_id})`,
        lines: g.lines,
        reason: excludeReason(type),
      };
    })
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  const scopeNote =
    channel === null
      ? "All channels: shipping, labor and other charges are actual totals (no allocation)."
      : `Channel ${channel}: revenue is actual; shipping label cost, labor and charges with no channel are ALLOCATED (labels are not tagged by channel, so no carrier split and labels are shown net of refunds). ${methodFor("channel", f)}`;

  return {
    period: opts.period,
    channel,
    revenue,
    shippingLabels: shipping,
    labor: { hours: f.hours, rateCentsPerHour: f.rate, costCents: laborCost, simulated: false, allocated: channel !== null },
    otherCharges,
    contributionCents,
    contributionPct: pct(contributionCents, revenue.netRevenueCents),
    excluded: { taxCollectedCents: sum("tax"), lines: excludedLines },
    missing: f.missing,
    method: `${METHOD_COMMON} ${scopeNote}`,
  };
}

export const getCostedMargin = cachedView("getCostedMargin", getCostedMarginUncached);
export const getCostBreakdown = cachedView("getCostBreakdown", getCostBreakdownUncached);
