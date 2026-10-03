/**
 * KPI catalog: the 15 KPIs of slide 35 in display order, with unit, pillar,
 * the 2027 anchors of slide 36, and which data each one depends on.
 *
 * dataBasis:
 * - "orders":      marketplace/statement facts -> status "ok" when computable
 * - "synthetic":   uses items and/or labor_hours, which are synthetic only
 *                  (research §6.11) -> status "simulated" when computable
 * Anything not computable -> "awaiting_data" with a null value.
 */
import type { Kpi } from "@/lib/views/types";
import * as F from "./formulas";
import type { PeriodFacts } from "./types";

export interface KpiDefinition {
  id: string;
  label: string;
  pillar: Kpi["pillar"];
  unit: Kpi["unit"];
  anchor2027: boolean;
  dataBasis: "orders" | "synthetic";
  compute: (f: PeriodFacts, prev: PeriodFacts | null) => number | null;
  note?: string;
}

export const KPI_DEFINITIONS: KpiDefinition[] = [
  { id: "total_revenue", label: "Total E-Commerce Revenue", pillar: "financial", unit: "cents", anchor2027: false, dataBasis: "orders", compute: F.totalRevenue },
  {
    id: "revenue_growth_pct", label: "Revenue Growth %", pillar: "financial", unit: "percent", anchor2027: false, dataBasis: "orders", compute: F.revenueGrowthPct,
    note: "Month over month; no prior-year data yet for YoY.",
  },
  {
    id: "net_margin_pct", label: "Net Margin %", pillar: "financial", unit: "percent", anchor2027: true, dataBasis: "orders", compute: (f) => F.netMarginPct(f),
    note: "After fees, refunds and shipping labels; labor and overhead not included yet.",
  },
  { id: "listings_created", label: "Listings Created", pillar: "productivity", unit: "count", anchor2027: false, dataBasis: "synthetic", compute: (f) => F.listingsCreated(f) },
  { id: "revenue_per_labor_hour", label: "Revenue per Labor Hour", pillar: "productivity", unit: "cents_per_hour", anchor2027: true, dataBasis: "synthetic", compute: (f) => F.revenuePerLaborHour(f) },
  { id: "listings_per_employee", label: "Listings per Employee", pillar: "productivity", unit: "ratio", anchor2027: false, dataBasis: "synthetic", compute: (f) => F.listingsPerEmployee(f) },
  { id: "days_donation_to_listing", label: "Days from Donation to Listing", pillar: "inventory", unit: "days", anchor2027: false, dataBasis: "synthetic", compute: (f) => F.daysDonationToListing(f) },
  { id: "unlisted_backlog", label: "Unlisted Inventory Backlog", pillar: "inventory", unit: "count", anchor2027: false, dataBasis: "synthetic", compute: (f) => F.unlistedBacklog(f) },
  {
    id: "unsold_inventory_pct", label: "Unsold Inventory %", pillar: "inventory", unit: "percent", anchor2027: false, dataBasis: "synthetic", compute: (f) => F.unsoldInventoryPct(f),
    note: "Share of open listings older than 60 days at period end.",
  },
  { id: "avg_selling_price", label: "Average Selling Price", pillar: "sales", unit: "cents", anchor2027: false, dataBasis: "orders", compute: (f) => F.avgSellingPrice(f) },
  { id: "sell_through_rate", label: "Sell-Through Rate", pillar: "sales", unit: "percent", anchor2027: true, dataBasis: "synthetic", compute: (f) => F.sellThroughRate(f) },
  { id: "sales_per_employee", label: "Sales per Employee", pillar: "sales", unit: "cents", anchor2027: false, dataBasis: "synthetic", compute: (f) => F.salesPerEmployee(f) },
  {
    id: "top10_categories_revenue", label: "Top 10 Categories by Revenue", pillar: "category_customer", unit: "cents", anchor2027: false, dataBasis: "orders", compute: (f) => F.top10CategoriesRevenue(f),
    note: "Value is the top 10 total; see topCategoriesByRevenue.",
  },
  {
    id: "top10_categories_margin", label: "Top 10 Categories by Margin", pillar: "category_customer", unit: "cents", anchor2027: false, dataBasis: "orders", compute: (f) => F.top10CategoriesMargin(f),
    note: "Margin = net after fees and refunds, excluding shipping charged; see topCategoriesByMargin.",
  },
  { id: "repeat_buyer_rate", label: "Repeat Buyer Rate", pillar: "category_customer", unit: "percent", anchor2027: false, dataBasis: "orders", compute: (f) => F.repeatBuyerRate(f) },
];

/** The three 2027 plan anchors (slide 36). */
export const ANCHOR_2027_KPI_IDS = KPI_DEFINITIONS.filter((k) => k.anchor2027).map((k) => k.id);
