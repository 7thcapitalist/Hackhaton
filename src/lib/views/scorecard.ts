/**
 * Monthly COO scorecard (slides 33-36): the 15 KPIs of slide 35 (group
 * "coo15") plus every other KPI of slides 33-34 (group "extended"), each with
 * prior month and target. This file only queries aggregates; every formula
 * lives in src/kpis/ (docs/kpi-definitions.md).
 * Status: "ok" (computable from ingested data: orders, marketplace metrics,
 * items, labor hours), "awaiting_data" (not computable; value null, never a
 * made-up number). Whether the dataset is mock is shown app-wide, not per KPI.
 * Server-only (uses the DB client).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  AGED_LISTING_DAYS,
  DEFAULT_KPI_TARGETS,
  DEFAULT_LABOR_RATE_CENTS_PER_HOUR,
  KPI_DEFINITIONS,
  categoryBreakdown,
  marketplaceByChannel,
  topCategoriesByMargin,
  topCategoriesByRevenue,
  type CategoryFacts,
  type MarketplaceMetricName,
  type PeriodFacts,
} from "@/kpis";
import { otherChargesTotalSql } from "./cost-sql";
import { addDays, businessDateOf, daysBetween, localToUtc, periodBounds, previousPeriod } from "./dates";
import type { Kpi, ScorecardView } from "./types";
import { cachedView } from "./cache";

const isoUtc = (d: Date) => d.toISOString();

/** Loaded processing labor rate in cents per hour: env LABOR_RATE_CENTS_PER_HOUR, default 1800 ($18.00/h). */
export function laborRateCentsPerHour(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.LABOR_RATE_CENTS_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LABOR_RATE_CENTS_PER_HOUR;
}

/** Same month one year earlier. */
function priorYearPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${Number(y) - 1}-${m}`;
}

async function loadPeriodFactsUncached(period: string): Promise<PeriodFacts> {
  const db = getDb();
  const { start, end } = periodBounds(period);
  // Item/labor timestamps are UTC; the period is in business time.
  const startUtc = isoUtc(localToUtc(start, 0));
  const endUtc = isoUtc(localToUtc(addDays(end, 1), 0)); // exclusive
  const agedCutoffUtc = isoUtc(localToUtc(addDays(end, 1 - AGED_LISTING_DAYS), 0));
  const py = priorYearPeriod(period);
  const pyBounds = periodBounds(py);

  const [o] = await db.all<{
    n: number;
    net: number;
    order_count: number;
    paid_gross: number;
    paid_qty: number;
    transactions: number;
    last_date: string | null;
  }>(sql`
    select count(*) as n,
           coalesce(sum(net_cents), 0) as net,
           count(case when status != 'cancelled' then 1 end) as order_count,
           coalesce(sum(case when status = 'paid' then gross_cents end), 0) as paid_gross,
           coalesce(sum(case when status = 'paid' then quantity end), 0) as paid_qty,
           count(distinct case when status != 'cancelled' then channel || ':' || external_order_id end) as transactions,
           max(business_date) as last_date
    from orders where business_date between ${start} and ${end}`);

  const unitPrices = await db.all<{ p: number }>(sql`
    select cast(gross_cents as real) / quantity as p
    from orders
    where business_date between ${start} and ${end} and status = 'paid' and quantity > 0
    order by p`);

  // Buyers: orders.buyer_key (salted hash per channel). Transaction = channel + external_order_id.
  const [b] = await db.all<{ buyers: number; repeat_buyers: number }>(sql`
    select count(*) as buyers, count(case when n >= 2 then 1 end) as repeat_buyers
    from (
      select buyer_key, count(distinct channel || ':' || external_order_id) as n
      from orders
      where business_date between ${start} and ${end} and status != 'cancelled' and buyer_key is not null
      group by buyer_key
    )`);
  const [nb] = await db.all<{ new_buyers: number }>(sql`
    select count(*) as new_buyers
    from (
      select buyer_key, min(business_date) as first_date
      from orders
      where status != 'cancelled' and buyer_key is not null
      group by buyer_key
    )
    where first_date between ${start} and ${end}`);
  const [nob] = await db.all<{ n: number }>(sql`
    select count(distinct channel || ':' || external_order_id) as n
    from orders
    where business_date between ${start} and ${end} and status != 'cancelled' and buyer_key is null`);

  const [s] = await db.all<{ lines: number; net: number }>(sql`
    select count(*) as lines, coalesce(sum(amount_cents), 0) as net
    from money_lines
    where period = ${period} and amount_type in ('shipping_label', 'shipping_refund')`);

  const [oc] = await db.all<{ lines: number; net: number }>(otherChargesTotalSql(period));

  const [l] = await db.all<{ hours: number; employees: number }>(sql`
    select coalesce(sum(hours), 0) as hours, count(distinct employee) as employees
    from labor_hours where work_date between ${start} and ${end}`);

  const [i] = await db.all<{
    any_items: number;
    identified: number;
    sent: number;
    listed: number;
    last_listed: string | null;
    avg_days: number | null;
    avg_days_sent: number | null;
    backlog: number;
    sold: number;
    avg_days_sell: number | null;
    available: number;
    relisted: number;
    active_end: number;
    aged_end: number;
  }>(sql`
    select
      count(case when coalesce(listed_at, sent_to_ecom_at, identified_at) < ${endUtc} then 1 end) as any_items,
      count(case when identified_at >= ${startUtc} and identified_at < ${endUtc} then 1 end) as identified,
      count(case when sent_to_ecom_at >= ${startUtc} and sent_to_ecom_at < ${endUtc} then 1 end) as sent,
      count(case when listed_at >= ${startUtc} and listed_at < ${endUtc} then 1 end) as listed,
      max(case when listed_at >= ${startUtc} and listed_at < ${endUtc} then listed_at end) as last_listed,
      avg(case when listed_at >= ${startUtc} and listed_at < ${endUtc} and donated_at is not null
               then julianday(listed_at) - julianday(donated_at) end) as avg_days,
      avg(case when listed_at >= ${startUtc} and listed_at < ${endUtc} and sent_to_ecom_at is not null
               then julianday(listed_at) - julianday(sent_to_ecom_at) end) as avg_days_sent,
      count(case when sent_to_ecom_at < ${endUtc} and (listed_at is null or listed_at >= ${endUtc}) then 1 end) as backlog,
      count(case when sold_at >= ${startUtc} and sold_at < ${endUtc} then 1 end) as sold,
      avg(case when sold_at >= ${startUtc} and sold_at < ${endUtc} and listed_at is not null
               then julianday(sold_at) - julianday(listed_at) end) as avg_days_sell,
      count(case when listed_at < ${endUtc} and (sold_at is null or sold_at >= ${startUtc}) then 1 end) as available,
      count(case when listed_at < ${endUtc} and (sold_at is null or sold_at >= ${startUtc}) and relist_count > 0 then 1 end) as relisted,
      count(case when listed_at < ${endUtc} and (sold_at is null or sold_at >= ${endUtc}) then 1 end) as active_end,
      count(case when listed_at < ${agedCutoffUtc} and (sold_at is null or sold_at >= ${endUtc}) then 1 end) as aged_end
    from items`);

  const orderCats = await db.all<{ category: string; revenue: number; margin: number; units: number; paid_gross: number }>(sql`
    select category,
           coalesce(sum(net_cents), 0) as revenue,
           coalesce(sum(net_cents - case when status = 'paid' then shipping_cents else 0 end), 0) as margin,
           coalesce(sum(case when status = 'paid' then quantity else 0 end), 0) as units,
           coalesce(sum(case when status = 'paid' then gross_cents else 0 end), 0) as paid_gross
    from orders
    where business_date between ${start} and ${end} and category is not null
    group by category`);

  const itemCats = await db.all<{ category: string; sold: number; available: number }>(sql`
    select category,
           count(case when sold_at >= ${startUtc} and sold_at < ${endUtc} then 1 end) as sold,
           count(case when listed_at < ${endUtc} and (sold_at is null or sold_at >= ${startUtc}) then 1 end) as available
    from items
    where category is not null
    group by category`);

  const [pyRev] = await db.all<{ n: number; net: number }>(sql`
    select count(*) as n, coalesce(sum(net_cents), 0) as net
    from orders where business_date between ${pyBounds.start} and ${pyBounds.end}`);

  // Partial period (orders stop before period end, e.g. the running month):
  // revenue of the same days 1..N in the comparison months, for growth.
  const lastDate = o?.last_date ?? null;
  let monthToDate: PeriodFacts["monthToDate"] = null;
  if (lastDate && lastDate < end) {
    const throughDay = Number(lastDate.slice(8, 10));
    const upTo = (p: string) => {
      const b = periodBounds(p);
      return { start: b.start, end: `${p}-${String(Math.min(throughDay, Number(b.end.slice(8, 10)))).padStart(2, "0")}` };
    };
    const pyMtd = upTo(py);
    const pmMtd = upTo(previousPeriod(period));
    const [m] = await db.all<{ py: number; pm: number }>(sql`
      select coalesce(sum(case when business_date between ${pyMtd.start} and ${pyMtd.end} then net_cents end), 0) as py,
             coalesce(sum(case when business_date between ${pmMtd.start} and ${pmMtd.end} then net_cents end), 0) as pm
      from orders
      where business_date between ${pyMtd.start} and ${pyMtd.end} or business_date between ${pmMtd.start} and ${pmMtd.end}`);
    monthToDate = { throughDay, priorYearNetCents: Number(m?.py ?? 0), prevMonthNetCents: Number(m?.pm ?? 0) };
  }

  const mm = await db.all<{ channel: string; metric: MarketplaceMetricName; value: number; sample_size: number | null }>(sql`
    select channel, metric, value, sample_size
    from marketplace_metrics
    where period = ${period}
    order by channel, metric`);

  const hasItems = !!i && Number(i.any_items) > 0;
  const hasOrders = !!o && Number(o.n) > 0;

  const catMap = new Map<string, CategoryFacts>();
  const cat = (name: string): CategoryFacts => {
    let c = catMap.get(name);
    if (!c) {
      c = {
        category: name,
        revenueCents: 0,
        marginCents: 0,
        units: 0,
        paidGrossCents: 0,
        itemsSold: hasItems ? 0 : null,
        itemsAvailable: hasItems ? 0 : null,
      };
      catMap.set(name, c);
    }
    return c;
  };
  for (const r of orderCats) {
    const c = cat(r.category);
    c.revenueCents = Number(r.revenue);
    c.marginCents = Number(r.margin);
    c.units = Number(r.units);
    c.paidGrossCents = Number(r.paid_gross);
  }
  if (hasItems) {
    for (const r of itemCats) {
      if (Number(r.sold) === 0 && Number(r.available) === 0) continue;
      const c = cat(r.category);
      c.itemsSold = Number(r.sold);
      c.itemsAvailable = Number(r.available);
    }
  }

  const hours = Number(l?.hours ?? 0);
  const rate = laborRateCentsPerHour();

  return {
    period,
    periodEnd: end,
    orders: hasOrders
      ? {
          netCents: Number(o!.net),
          orderCount: Number(o!.order_count),
          paidGrossCents: Number(o!.paid_gross),
          paidQuantity: Number(o!.paid_qty),
          paidUnitPricesCents: unitPrices.map((r) => Number(r.p)),
          transactions: Number(o!.transactions),
          lastBusinessDate: o!.last_date,
        }
      : null,
    buyers: hasOrders
      ? {
          buyers: Number(b?.buyers ?? 0),
          repeatBuyers: Number(b?.repeat_buyers ?? 0),
          newBuyers: Number(nb?.new_buyers ?? 0),
          transactionsWithoutBuyer: Number(nob?.n ?? 0),
        }
      : null,
    shipping: s && Number(s.lines) > 0 ? { netShippingCents: Number(s.net), lines: Number(s.lines) } : null,
    otherCharges: oc ? { netCents: Number(oc.net), lines: Number(oc.lines) } : null,
    labor:
      hours > 0
        ? { hours, employees: Number(l!.employees), rateCentsPerHour: rate, costCents: Math.round(hours * rate) }
        : null,
    items: hasItems
      ? {
          identified: Number(i!.identified),
          sentToEcom: Number(i!.sent),
          listed: Number(i!.listed),
          listingDays: i!.last_listed ? daysBetween(start, businessDateOf(i!.last_listed)) + 1 : 0,
          avgDaysDonationToListing: i!.avg_days === null ? null : Number(i!.avg_days),
          avgDaysSentToListing: i!.avg_days_sent === null ? null : Number(i!.avg_days_sent),
          backlogAtEnd: Number(i!.backlog),
          sold: Number(i!.sold),
          avgDaysToSell: i!.avg_days_sell === null ? null : Number(i!.avg_days_sell),
          available: Number(i!.available),
          relistedAvailable: Number(i!.relisted),
          activeAtEnd: Number(i!.active_end),
          agedAtEnd: Number(i!.aged_end),
        }
      : null,
    categories: [...catMap.values()],
    priorYear: pyRev && Number(pyRev.n) > 0 ? { period: py, netCents: Number(pyRev.net) } : null,
    monthToDate,
    marketplace: mm.map((r) => ({
      channel: r.channel,
      metric: r.metric,
      value: Number(r.value),
      sampleSize: r.sample_size === null ? null : Number(r.sample_size),
    })),
  };
}

/** Loads one period's facts; pass a per-request cached loader to share loads between views. */
export type PeriodFactsLoader = (period: string) => Promise<PeriodFacts>;

/**
 * Target for a KPI: the period's kpi_targets row when there is one, otherwise the
 * default placeholder target (src/kpis/targets.ts), otherwise null.
 */
function targetFor(kpiId: string, stored: Map<string, number>): number | null {
  return stored.get(kpiId) ?? DEFAULT_KPI_TARGETS[kpiId] ?? null;
}

/** Scorecard for a period (`YYYY-MM`). */
async function getScorecardUncached(period: string, load: PeriodFactsLoader = loadPeriodFacts): Promise<ScorecardView> {
  const prevPeriod = previousPeriod(period);
  const [cur, prev, prev2, targets] = await Promise.all([
    load(period),
    load(prevPeriod),
    load(previousPeriod(prevPeriod)),
    getDb().all<{ kpi_key: string; target_value: number }>(
      sql`select kpi_key, target_value from kpi_targets where period = ${period}`,
    ),
  ]);
  const targetByKey = new Map(targets.map((t) => [t.kpi_key, Number(t.target_value)]));

  const lastDate = cur.orders?.lastBusinessDate;
  const partialNote = lastDate && lastDate < cur.periodEnd ? `Partial month: data through ${lastDate}.` : null;

  const kpis: Kpi[] = KPI_DEFINITIONS.map((def) => {
    const value = def.compute(cur, prev);
    const previous = def.compute(prev, prev2);
    // Items and labor now arrive through ingested sources like orders do, so every computable KPI is "ok".
    // Whether the whole dataset is mock is shown app-wide (demo banner), not per KPI.
    const status: Kpi["status"] = value === null ? "awaiting_data" : "ok";
    const notes = [def.note];
    if (value !== null && def.dynamicNote) notes.push(def.dynamicNote(cur) ?? undefined);
    if (status === "awaiting_data") notes.push("Awaiting data for this period.");
    if (partialNote && value !== null) notes.push(partialNote);
    const note = notes.filter(Boolean).join(" ");
    return {
      id: def.id,
      label: def.label,
      pillar: def.pillar,
      unit: def.unit,
      value,
      previous,
      target: targetFor(def.id, targetByKey),
      status,
      anchor2027: def.anchor2027,
      higherIsBetter: def.higherIsBetter,
      group: def.group,
      ...(note ? { note } : {}),
    };
  });

  return {
    period,
    kpis,
    topCategoriesByRevenue: topCategoriesByRevenue(cur.categories),
    topCategoriesByMargin: topCategoriesByMargin(cur.categories),
    categories: categoryBreakdown(cur.categories),
    marketplaceMetrics: marketplaceByChannel(cur),
  };
}

export const loadPeriodFacts = cachedView("loadPeriodFacts", loadPeriodFactsUncached);
const getScorecardCached = cachedView("getScorecard", (period: string) => getScorecardUncached(period));

/** Scorecard for a period (`YYYY-MM`). Cached unless a custom facts loader is passed. */
export function getScorecard(period: string, load?: PeriodFactsLoader): Promise<ScorecardView> {
  return load ? getScorecardUncached(period, load) : getScorecardCached(period);
}
