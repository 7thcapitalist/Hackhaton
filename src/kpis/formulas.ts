/**
 * The 15 KPIs of slide 35, one pure function each. Each returns null when the
 * inputs it needs are missing; the caller maps null to "awaiting_data".
 * Rounding: percentages and ratios to 1 decimal, money to whole cents.
 */
import type { CategoryFacts, PeriodFacts } from "./types";

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : null);

// ---- Financial -------------------------------------------------------------

/** total_revenue = Σ orders.net_cents in the period (gross + shipping − refunds − fees, tax excluded). */
export function totalRevenue(f: PeriodFacts): number | null {
  return f.orders ? f.orders.netCents : null;
}

/**
 * revenue_growth_pct = (revenue − prior month revenue) / prior month revenue × 100.
 * Month over month: slide 33 asks YoY, but there is no prior-year data yet.
 */
export function revenueGrowthPct(f: PeriodFacts, prev: PeriodFacts | null): number | null {
  const cur = totalRevenue(f);
  const before = prev ? totalRevenue(prev) : null;
  if (cur === null || before === null || before <= 0) return null;
  return round1(((cur - before) / before) * 100);
}

/**
 * net_margin_pct = (revenue + net shipping cost lines) / revenue × 100.
 * Shipping cost lines are negative (labels) and positive (carrier refunds).
 * Contribution margin: labor and overhead are not in the data yet (TBC).
 * Needs the shipping sources for the period, else null.
 */
export function netMarginPct(f: PeriodFacts): number | null {
  if (!f.orders || !f.shipping || f.shipping.lines === 0) return null;
  return pct(f.orders.netCents + f.shipping.netShippingCents, f.orders.netCents);
}

// ---- Productivity ----------------------------------------------------------

/** listings_created = count of items with listed_at in the period. */
export function listingsCreated(f: PeriodFacts): number | null {
  return f.items ? f.items.listed : null;
}

/** revenue_per_labor_hour = total revenue / Σ labor_hours.hours (cents per hour). */
export function revenuePerLaborHour(f: PeriodFacts): number | null {
  if (!f.orders || !f.labor || f.labor.hours <= 0) return null;
  return Math.round(f.orders.netCents / f.labor.hours);
}

/** listings_per_employee = listings created / distinct employees with labor hours in the period. */
export function listingsPerEmployee(f: PeriodFacts): number | null {
  if (!f.items || !f.labor || f.labor.employees === 0) return null;
  return round1(f.items.listed / f.labor.employees);
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

// ---- Category + customer ---------------------------------------------------

export function topCategoriesByRevenue(cats: CategoryFacts[], n = 10) {
  return [...cats]
    .sort((a, b) => b.revenueCents - a.revenueCents || a.category.localeCompare(b.category))
    .slice(0, n)
    .map((c) => ({ category: c.category, revenueCents: c.revenueCents }));
}

export function topCategoriesByMargin(cats: CategoryFacts[], n = 10) {
  return [...cats]
    .sort((a, b) => b.marginCents - a.marginCents || a.category.localeCompare(b.category))
    .slice(0, n)
    .map((c) => ({ category: c.category, marginCents: c.marginCents }));
}

/** top10_categories_revenue = Σ revenue of the 10 highest-revenue categories (list in the view). */
export function top10CategoriesRevenue(f: PeriodFacts): number | null {
  if (f.categories.length === 0) return null;
  return topCategoriesByRevenue(f.categories).reduce((s, c) => s + c.revenueCents, 0);
}

/** top10_categories_margin = Σ margin of the 10 highest-margin categories (list in the view). */
export function top10CategoriesMargin(f: PeriodFacts): number | null {
  if (f.categories.length === 0) return null;
  return topCategoriesByMargin(f.categories).reduce((s, c) => s + c.marginCents, 0);
}

/**
 * repeat_buyer_rate = buyers with 2+ orders in the period / distinct buyers × 100.
 * Buyer keys are salted per source, so the same person on two marketplaces counts twice.
 */
export function repeatBuyerRate(f: PeriodFacts): number | null {
  if (!f.orders) return null;
  return pct(f.orders.repeatBuyers, f.orders.buyers);
}
