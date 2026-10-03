/**
 * KPI formulas (slides 33-36), one pure function each. Each returns null when
 * the inputs it needs are missing; the caller maps null to "awaiting_data".
 * Rounding: percentages and ratios to 1 decimal, money to whole cents.
 *
 * Money basis: orders.net_cents = gross + shipping charged − refunds − marketplace
 * fees (tax excluded). So "net revenue" is already after fees and refunds; no
 * formula below subtracts fees again.
 */
import type { CategoryFacts, MarketplaceMetricName, PeriodFacts } from "./types";

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : null);

// ---- Financial -------------------------------------------------------------

/** total_revenue = Σ orders.net_cents in the period (gross + shipping − refunds − fees, tax excluded). */
export function totalRevenue(f: PeriodFacts): number | null {
  return f.orders ? f.orders.netCents : null;
}

/**
 * revenue_growth_pct (slide 33 asks YoY):
 * - YoY when the same month last year has orders:
 *   (revenue − revenue same month last year) / revenue same month last year × 100
 * - else MoM: (revenue − prior month revenue) / prior month revenue × 100
 */
export function revenueGrowthPct(f: PeriodFacts, prev: PeriodFacts | null): number | null {
  const cur = totalRevenue(f);
  if (cur === null) return null;
  const before = f.priorYear ? f.priorYear.netCents : prev ? totalRevenue(prev) : null;
  if (before === null || before <= 0) return null;
  return round1(((cur - before) / before) * 100);
}

/**
 * gross_margin_pct = (net revenue − processing labor cost) / net revenue × 100.
 * Processing labor cost = Σ labor_hours.hours × loaded hourly rate
 * (LABOR_RATE_CENTS_PER_HOUR, default 1800 = $18.00/h, an assumption).
 */
export function grossMarginPct(f: PeriodFacts): number | null {
  if (!f.orders || !f.labor) return null;
  return pct(f.orders.netCents - f.labor.costCents, f.orders.netCents);
}

/**
 * net_margin_pct = (net revenue + net shipping cost lines − processing labor cost) / net revenue × 100.
 * Net revenue is already after marketplace fees and refunds. Shipping cost lines
 * are negative (labels) and positive (carrier refunds). Overhead is not included.
 * Needs the shipping sources and labor hours for the period, else null. 2027 anchor.
 */
export function netMarginPct(f: PeriodFacts): number | null {
  if (!f.orders || !f.shipping || f.shipping.lines === 0 || !f.labor) return null;
  return pct(f.orders.netCents + f.shipping.netShippingCents - f.labor.costCents, f.orders.netCents);
}

/** revenue_per_labor_hour = total revenue / Σ labor_hours.hours (cents per hour). 2027 anchor. */
export function revenuePerLaborHour(f: PeriodFacts): number | null {
  if (!f.orders || !f.labor || f.labor.hours <= 0) return null;
  return Math.round(f.orders.netCents / f.labor.hours);
}

/**
 * profit_per_labor_hour = (net revenue − processing labor cost − net shipping cost) / Σ labor hours
 * (cents per hour). Net shipping cost = −(Σ shipping_label + shipping_refund lines).
 */
export function profitPerLaborHour(f: PeriodFacts): number | null {
  if (!f.orders || !f.labor || f.labor.hours <= 0 || !f.shipping || f.shipping.lines === 0) return null;
  return Math.round((f.orders.netCents - f.labor.costCents + f.shipping.netShippingCents) / f.labor.hours);
}

// ---- Productivity / listing & production -----------------------------------

/** listings_created = count of items with listed_at in the period. */
export function listingsCreated(f: PeriodFacts): number | null {
  return f.items ? f.items.listed : null;
}

/** listings_per_employee = listings created / distinct employees with labor hours in the period. */
export function listingsPerEmployee(f: PeriodFacts): number | null {
  if (!f.items || !f.labor || f.labor.employees === 0) return null;
  return round1(f.items.listed / f.labor.employees);
}

/** items_identified = count of items with identified_at in the period. */
export function itemsIdentified(f: PeriodFacts): number | null {
  return f.items ? f.items.identified : null;
}

/** items_sent_to_ecom = count of items with sent_to_ecom_at in the period. */
export function itemsSentToEcom(f: PeriodFacts): number | null {
  return f.items ? f.items.sentToEcom : null;
}

/**
 * listings_per_day = listings created / calendar days elapsed in the period
 * (period start through the business date of the last listing, so a partial
 * month is not diluted by days that haven't happened).
 */
export function listingsPerDay(f: PeriodFacts): number | null {
  if (!f.items || f.items.listingDays <= 0) return null;
  return round1(f.items.listed / f.items.listingDays);
}

/** avg_time_to_list_days = mean(listed_at − sent_to_ecom_at) in days, items listed in the period. */
export function avgTimeToListDays(f: PeriodFacts): number | null {
  const v = f.items?.avgDaysSentToListing;
  return v === null || v === undefined ? null : round1(v);
}

// ---- Inventory -------------------------------------------------------------

/** days_donation_to_listing = mean(listed_at − donated_at) in days, items listed in the period. */
export function daysDonationToListing(f: PeriodFacts): number | null {
  const v = f.items?.avgDaysDonationToListing;
  return v === null || v === undefined ? null : round1(v);
}

/** unlisted_backlog = items sent to e-commerce by period end and not listed at period end. */
export function unlistedBacklog(f: PeriodFacts): number | null {
  return f.items ? f.items.backlogAtEnd : null;
}

/**
 * unsold_inventory_pct = listings unsold at period end that are older than
 * AGED_LISTING_DAYS / all listings unsold at period end × 100.
 */
export function unsoldInventoryPct(f: PeriodFacts): number | null {
  if (!f.items) return null;
  return pct(f.items.agedAtEnd, f.items.activeAtEnd);
}

// ---- Sales -----------------------------------------------------------------

/** avg_selling_price = Σ gross_cents / Σ quantity over paid orders (cents). */
export function avgSellingPrice(f: PeriodFacts): number | null {
  if (!f.orders || f.orders.paidQuantity === 0) return null;
  return Math.round(f.orders.paidGrossCents / f.orders.paidQuantity);
}

/** median_sale_price = median of per-unit price (gross_cents / quantity) over paid order lines (cents). */
export function medianSalePrice(f: PeriodFacts): number | null {
  const p = f.orders?.paidUnitPricesCents;
  if (!p || p.length === 0) return null;
  const mid = Math.floor(p.length / 2);
  return Math.round(p.length % 2 ? p[mid]! : (p[mid - 1]! + p[mid]!) / 2);
}

/** sell_through_rate = items sold in period / items available in period × 100. 2027 anchor. */
export function sellThroughRate(f: PeriodFacts): number | null {
  if (!f.items) return null;
  return pct(f.items.sold, f.items.available);
}

/** sales_per_employee = total revenue / distinct employees with labor hours (cents). */
export function salesPerEmployee(f: PeriodFacts): number | null {
  if (!f.orders || !f.labor || f.labor.employees === 0) return null;
  return Math.round(f.orders.netCents / f.labor.employees);
}

/** days_to_sell = mean(sold_at − listed_at) in days, items sold in the period. */
export function daysToSell(f: PeriodFacts): number | null {
  const v = f.items?.avgDaysToSell;
  return v === null || v === undefined ? null : round1(v);
}

/** relisted_inventory_pct = available items with relist_count > 0 / items available in period × 100. */
export function relistedInventoryPct(f: PeriodFacts): number | null {
  if (!f.items) return null;
  return pct(f.items.relistedAvailable, f.items.available);
}

// ---- Category ----------------------------------------------------------------

export interface CategoryRow {
  category: string;
  revenueCents: number;
  marginCents: number;
  units: number;
  /** items sold / items available × 100 (synthetic items); null without item data. */
  sellThroughPct: number | null;
  /** paid gross / paid units; null when no units sold. */
  aspCents: number | null;
}

/** Per-category breakdown, sorted by revenue (desc). */
export function categoryBreakdown(cats: CategoryFacts[]): CategoryRow[] {
  return [...cats]
    .sort((a, b) => b.revenueCents - a.revenueCents || a.category.localeCompare(b.category))
    .map((c) => ({
      category: c.category,
      revenueCents: c.revenueCents,
      marginCents: c.marginCents,
      units: c.units,
      sellThroughPct: c.itemsSold === null || c.itemsAvailable === null ? null : pct(c.itemsSold, c.itemsAvailable),
      aspCents: c.units > 0 ? Math.round(c.paidGrossCents / c.units) : null,
    }));
}

/** Categories that have order lines in the period (not only synthetic items). */
const withOrders = (cats: CategoryFacts[]) =>
  cats.filter((c) => c.revenueCents !== 0 || c.marginCents !== 0 || c.units > 0 || c.paidGrossCents !== 0);
const orderCats = (f: PeriodFacts) => withOrders(f.categories);

export function topCategoriesByRevenue(cats: CategoryFacts[], n = 10) {
  return withOrders(cats)
    .sort((a, b) => b.revenueCents - a.revenueCents || a.category.localeCompare(b.category))
    .slice(0, n)
    .map((c) => ({ category: c.category, revenueCents: c.revenueCents }));
}

export function topCategoriesByMargin(cats: CategoryFacts[], n = 10) {
  return withOrders(cats)
    .sort((a, b) => b.marginCents - a.marginCents || a.category.localeCompare(b.category))
    .slice(0, n)
    .map((c) => ({ category: c.category, marginCents: c.marginCents }));
}

/** top10_categories_revenue = Σ revenue of the 10 highest-revenue categories (list in the view). */
export function top10CategoriesRevenue(f: PeriodFacts): number | null {
  if (orderCats(f).length === 0) return null;
  return topCategoriesByRevenue(f.categories).reduce((s, c) => s + c.revenueCents, 0);
}

/** top10_categories_margin = Σ margin of the 10 highest-margin categories (list in the view). */
export function top10CategoriesMargin(f: PeriodFacts): number | null {
  if (orderCats(f).length === 0) return null;
  return topCategoriesByMargin(f.categories).reduce((s, c) => s + c.marginCents, 0);
}

/** sales_by_category: value = Σ net revenue over categorized orders (breakdown in categories[]). */
export function salesByCategory(f: PeriodFacts): number | null {
  const c = orderCats(f);
  return c.length ? c.reduce((s, x) => s + x.revenueCents, 0) : null;
}

/** margin_by_category: value = Σ (net − shipping charged on paid orders) over categorized orders. */
export function marginByCategory(f: PeriodFacts): number | null {
  const c = orderCats(f);
  return c.length ? c.reduce((s, x) => s + x.marginCents, 0) : null;
}

/** units_by_category: value = Σ quantity of paid categorized order lines. */
export function unitsByCategory(f: PeriodFacts): number | null {
  const c = orderCats(f);
  return c.length ? c.reduce((s, x) => s + x.units, 0) : null;
}

/** sell_through_by_category: value = Σ items sold / Σ items available over categorized items × 100. */
export function sellThroughByCategory(f: PeriodFacts): number | null {
  const c = f.categories.filter((x) => x.itemsAvailable !== null && x.itemsSold !== null);
  if (!c.length) return null;
  return pct(
    c.reduce((s, x) => s + x.itemsSold!, 0),
    c.reduce((s, x) => s + x.itemsAvailable!, 0),
  );
}

/** asp_by_category: value = Σ paid gross / Σ paid units over categorized order lines (cents). */
export function aspByCategory(f: PeriodFacts): number | null {
  const c = orderCats(f);
  const units = c.reduce((s, x) => s + x.units, 0);
  return units > 0 ? Math.round(c.reduce((s, x) => s + x.paidGrossCents, 0) / units) : null;
}

// ---- Customer --------------------------------------------------------------

/** number_of_buyers = distinct orders.buyer_key with ≥1 non-cancelled transaction in the period. */
export function numberOfBuyers(f: PeriodFacts): number | null {
  return f.buyers && f.buyers.buyers > 0 ? f.buyers.buyers : null;
}

/**
 * repeat_buyer_rate = buyers with 2+ transactions in the period / buyers with ≥1
 * transaction in the period × 100. Transaction = distinct channel + external_order_id.
 */
export function repeatBuyerRate(f: PeriodFacts): number | null {
  if (!f.buyers) return null;
  return pct(f.buyers.repeatBuyers, f.buyers.buyers);
}

/** new_buyers = distinct buyer_key whose first-ever transaction (all history in the DB) falls in the period. */
export function newBuyers(f: PeriodFacts): number | null {
  return f.buyers && f.buyers.buyers > 0 ? f.buyers.newBuyers : null;
}

// ---- Marketplace -------------------------------------------------------------

/**
 * Average of one marketplace metric across channels for the period: weighted
 * by sample_size when every row has one, else a simple mean. null when no rows.
 */
export function marketplaceAverage(f: PeriodFacts, metric: MarketplaceMetricName): number | null {
  const rows = f.marketplace.filter((m) => m.metric === metric);
  if (!rows.length) return null;
  const weighted = rows.every((r) => r.sampleSize !== null && r.sampleSize > 0);
  const w = (r: (typeof rows)[number]) => (weighted ? r.sampleSize! : 1);
  const total = rows.reduce((s, r) => s + w(r), 0);
  return round2(rows.reduce((s, r) => s + r.value * w(r), 0) / total);
}

/** csat = marketplaceAverage(csat), on the marketplace's own scale (e.g. 4.8 of 5). */
export const csat = (f: PeriodFacts) => marketplaceAverage(f, "csat");
/** nps = marketplaceAverage(nps), −100..100. */
export const nps = (f: PeriodFacts) => marketplaceAverage(f, "nps");
/** marketplace_conversion = marketplaceAverage(conversion_rate), percent (2.4 = 2.4%). Per channel in marketplaceMetrics[]. */
export const marketplaceConversion = (f: PeriodFacts) => marketplaceAverage(f, "conversion_rate");

export interface MarketplaceRow {
  channel: string;
  csat: number | null;
  nps: number | null;
  conversionRate: number | null;
  sellerRating: number | null;
}

/** One row per channel that has any marketplace metric in the period. */
export function marketplaceByChannel(f: PeriodFacts): MarketplaceRow[] {
  const byChannel = new Map<string, MarketplaceRow>();
  for (const m of f.marketplace) {
    const row = byChannel.get(m.channel) ?? { channel: m.channel, csat: null, nps: null, conversionRate: null, sellerRating: null };
    if (m.metric === "csat") row.csat = m.value;
    else if (m.metric === "nps") row.nps = m.value;
    else if (m.metric === "conversion_rate") row.conversionRate = m.value;
    else if (m.metric === "seller_rating") row.sellerRating = m.value;
    byChannel.set(m.channel, row);
  }
  return [...byChannel.values()].sort((a, b) => a.channel.localeCompare(b.channel));
}
