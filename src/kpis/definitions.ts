/**
 * KPI catalog. First the 15 KPIs of slide 35 in display order (group "coo15",
 * ids unchanged; the 3 anchors of slide 36 among them), then every other KPI of
 * slides 33-34 (group "extended"). Formulas live in ./formulas.ts.
 *
 * dataBasis:
 * - "orders":      marketplace/statement facts -> status "ok" when computable
 * - "marketplace": marketplace_metrics rows (CSAT, NPS, conversion) -> "ok"
 * - "synthetic":   uses items and/or labor_hours, which are synthetic only
 *                  (research §6.11) -> status "simulated" when computable
 * Anything not computable -> "awaiting_data" with a null value.
 * Full table: docs/kpi-definitions.md.
 */
import type { Kpi } from "@/lib/views/types";
import * as F from "./formulas";
import type { PeriodFacts } from "./types";

export interface KpiDefinition {
  id: string;
  label: string;
  pillar: Kpi["pillar"];
  unit: Kpi["unit"];
  group: Kpi["group"];
  /** Slide where Goodwill lists the KPI. */
  slide: 33 | 34 | 35;
  anchor2027: boolean;
  dataBasis: "orders" | "marketplace" | "synthetic";
  compute: (f: PeriodFacts, prev: PeriodFacts | null) => number | null;
  /** Static note shown with the KPI. */
  note?: string;
  /** Note that depends on the period's data (e.g. YoY vs MoM). */
  dynamicNote?: (f: PeriodFacts) => string | null;
}

const fmtRate = (cents: number) => `$${(cents / 100).toFixed(2)}/h`;

const laborNote = (f: PeriodFacts) =>
  f.labor
    ? `Processing labor cost = labor hours × ${fmtRate(f.labor.rateCentsPerHour)} loaded rate (assumption, LABOR_RATE_CENTS_PER_HOUR).`
    : null;

const buyerNote = (f: PeriodFacts) =>
  f.buyers && f.buyers.transactionsWithoutBuyer > 0
    ? `${f.buyers.transactionsWithoutBuyer} transactions without a buyer id (e.g. Amazon) are excluded.`
    : null;

const growthNote = (f: PeriodFacts) =>
  f.priorYear ? `YoY vs ${f.priorYear.period}.` : "MoM: no prior-year data.";

const catNote = "Breakdown per category in categories[].";

export const KPI_DEFINITIONS: KpiDefinition[] = [
  // ---- Slide 35: the 15 COO KPIs ------------------------------------------
  { id: "total_revenue", label: "Total E-Commerce Revenue", pillar: "financial", unit: "cents", group: "coo15", slide: 35, anchor2027: false, dataBasis: "orders", compute: F.totalRevenue },
  { id: "revenue_growth_pct", label: "Revenue Growth %", pillar: "financial", unit: "percent", group: "coo15", slide: 35, anchor2027: false, dataBasis: "orders", compute: F.revenueGrowthPct, dynamicNote: growthNote },
  {
    id: "net_margin_pct", label: "Net Margin %", pillar: "financial", unit: "percent", group: "coo15", slide: 35, anchor2027: true, dataBasis: "synthetic", compute: (f) => F.netMarginPct(f),
    note: "Net revenue (after fees and refunds) minus shipping labels and processing labor; overhead not included.",
    dynamicNote: laborNote,
  },
  { id: "listings_created", label: "Listings Created", pillar: "productivity", unit: "count", group: "coo15", slide: 35, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.listingsCreated(f) },
  { id: "revenue_per_labor_hour", label: "Revenue per Labor Hour", pillar: "productivity", unit: "cents_per_hour", group: "coo15", slide: 35, anchor2027: true, dataBasis: "synthetic", compute: (f) => F.revenuePerLaborHour(f) },
  { id: "listings_per_employee", label: "Listings per Employee", pillar: "productivity", unit: "ratio", group: "coo15", slide: 35, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.listingsPerEmployee(f) },
  { id: "days_donation_to_listing", label: "Days from Donation to Listing", pillar: "inventory", unit: "days", group: "coo15", slide: 35, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.daysDonationToListing(f) },
  { id: "unlisted_backlog", label: "Unlisted Inventory Backlog", pillar: "inventory", unit: "count", group: "coo15", slide: 35, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.unlistedBacklog(f) },
  {
    id: "unsold_inventory_pct", label: "Unsold Inventory %", pillar: "inventory", unit: "percent", group: "coo15", slide: 35, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.unsoldInventoryPct(f),
    note: "Share of open listings older than 60 days at period end.",
  },
  { id: "avg_selling_price", label: "Average Selling Price", pillar: "sales", unit: "cents", group: "coo15", slide: 35, anchor2027: false, dataBasis: "orders", compute: (f) => F.avgSellingPrice(f) },
  { id: "sell_through_rate", label: "Sell-Through Rate", pillar: "sales", unit: "percent", group: "coo15", slide: 35, anchor2027: true, dataBasis: "synthetic", compute: (f) => F.sellThroughRate(f) },
  { id: "sales_per_employee", label: "Sales per Employee", pillar: "sales", unit: "cents", group: "coo15", slide: 35, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.salesPerEmployee(f) },
  {
    id: "top10_categories_revenue", label: "Top 10 Categories by Revenue", pillar: "category_customer", unit: "cents", group: "coo15", slide: 35, anchor2027: false, dataBasis: "orders", compute: (f) => F.top10CategoriesRevenue(f),
    note: "Value is the top 10 total; see topCategoriesByRevenue.",
  },
  {
    id: "top10_categories_margin", label: "Top 10 Categories by Margin", pillar: "category_customer", unit: "cents", group: "coo15", slide: 35, anchor2027: false, dataBasis: "orders", compute: (f) => F.top10CategoriesMargin(f),
    note: "Margin = net after fees and refunds, excluding shipping charged; see topCategoriesByMargin.",
  },
  {
    id: "repeat_buyer_rate", label: "Repeat Buyer Rate", pillar: "category_customer", unit: "percent", group: "coo15", slide: 35, anchor2027: false, dataBasis: "orders", compute: (f) => F.repeatBuyerRate(f),
    note: "Buyers with 2+ transactions / buyers in the period; a buyer is tracked per channel.",
    dynamicNote: buyerNote,
  },

  // ---- Slide 33: financial + listing & production ---------------------------
  {
    id: "gross_margin_pct", label: "Gross Margin %", pillar: "financial", unit: "percent", group: "extended", slide: 33, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.grossMarginPct(f),
    note: "(Net revenue − processing labor cost) / net revenue.",
    dynamicNote: laborNote,
  },
  {
    id: "profit_per_labor_hour", label: "Profit per Labor Hour", pillar: "financial", unit: "cents_per_hour", group: "extended", slide: 33, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.profitPerLaborHour(f),
    note: "(Net revenue − processing labor cost − net shipping cost) / labor hours.",
    dynamicNote: laborNote,
  },
  { id: "items_identified", label: "Items Identified for E-Commerce", pillar: "productivity", unit: "count", group: "extended", slide: 33, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.itemsIdentified(f) },
  { id: "items_sent_to_ecom", label: "Items Sent to E-Commerce", pillar: "productivity", unit: "count", group: "extended", slide: 33, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.itemsSentToEcom(f) },
  {
    id: "listings_per_day", label: "Listings Created per Day", pillar: "productivity", unit: "ratio", group: "extended", slide: 33, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.listingsPerDay(f),
    note: "Per calendar day elapsed in the period.",
  },
  {
    id: "avg_time_to_list_days", label: "Average Time to List an Item", pillar: "productivity", unit: "days", group: "extended", slide: 33, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.avgTimeToListDays(f),
    note: "Days from sent to e-commerce to listed.",
  },

  // ---- Slide 34: sales effectiveness ---------------------------------------
  { id: "median_sale_price", label: "Median Sale Price", pillar: "sales", unit: "cents", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.medianSalePrice(f) },
  {
    id: "days_to_sell", label: "Days to Sell", pillar: "sales", unit: "days", group: "extended", slide: 34, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.daysToSell(f),
    note: "Days from listed to sold, items sold in the period.",
  },
  { id: "relisted_inventory_pct", label: "Relisted Inventory %", pillar: "sales", unit: "percent", group: "extended", slide: 34, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.relistedInventoryPct(f) },

  // ---- Slide 34: category performance --------------------------------------
  { id: "sales_by_category", label: "Sales by Category", pillar: "category_customer", unit: "cents", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.salesByCategory(f), note: `Value is the total over categorized orders. ${catNote}` },
  { id: "margin_by_category", label: "Margin by Category", pillar: "category_customer", unit: "cents", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.marginByCategory(f), note: `Value is the total over categorized orders. ${catNote}` },
  { id: "units_by_category", label: "Units Sold by Category", pillar: "category_customer", unit: "count", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.unitsByCategory(f), note: `Value is the total over categorized orders. ${catNote}` },
  { id: "sell_through_by_category", label: "Sell-Through Rate by Category", pillar: "category_customer", unit: "percent", group: "extended", slide: 34, anchor2027: false, dataBasis: "synthetic", compute: (f) => F.sellThroughByCategory(f), note: `Value is the rate over categorized items. ${catNote}` },
  { id: "asp_by_category", label: "Average Selling Price by Category", pillar: "category_customer", unit: "cents", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.aspByCategory(f), note: `Value is the ASP over categorized orders. ${catNote}` },

  // ---- Slide 34: customer & marketplace -------------------------------------
  { id: "number_of_buyers", label: "Number of Buyers", pillar: "category_customer", unit: "count", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.numberOfBuyers(f), note: "Distinct buyers; a buyer is tracked per channel.", dynamicNote: buyerNote },
  { id: "new_buyers", label: "New Buyers", pillar: "category_customer", unit: "count", group: "extended", slide: 34, anchor2027: false, dataBasis: "orders", compute: (f) => F.newBuyers(f), note: "Buyers whose first transaction on record is in this period.", dynamicNote: buyerNote },
  { id: "csat", label: "Customer Satisfaction Rating", pillar: "category_customer", unit: "ratio", group: "extended", slide: 34, anchor2027: false, dataBasis: "marketplace", compute: (f) => F.csat(f), note: "Average across channels (weighted by sample size when known); per channel in marketplaceMetrics[]." },
  { id: "nps", label: "Net Promoter Score", pillar: "category_customer", unit: "ratio", group: "extended", slide: 34, anchor2027: false, dataBasis: "marketplace", compute: (f) => F.nps(f), note: "−100 to 100. Average across channels; per channel in marketplaceMetrics[]." },
  { id: "marketplace_conversion", label: "Marketplace Conversion", pillar: "category_customer", unit: "percent", group: "extended", slide: 34, anchor2027: false, dataBasis: "marketplace", compute: (f) => F.marketplaceConversion(f), note: "Average across channels; per channel in marketplaceMetrics[]." },
];

/** The three 2027 plan anchors (slide 36). */
export const ANCHOR_2027_KPI_IDS = KPI_DEFINITIONS.filter((k) => k.anchor2027).map((k) => k.id);
/** The 15 KPIs of the one-page COO scorecard (slide 35). */
export const COO15_KPI_IDS = KPI_DEFINITIONS.filter((k) => k.group === "coo15").map((k) => k.id);
