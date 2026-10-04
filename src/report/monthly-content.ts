import type { KpiUnit, ScorecardExportData } from "../export/types";

export type ReportKpi = ScorecardExportData["kpis"][number];
interface Meaning { name: string; meaning: string; unit?: string; caution?: string }

// Presentation only. Definitions were checked against the shared KPI formulas.
const meanings: Record<string, Meaning> = {
  total_revenue: { name: "Online sales revenue", meaning: "Sales and shipping collected, after marketplace fees and refunds. Tax is excluded. Revenue is not profit." },
  revenue_growth_pct: { name: "Revenue change", meaning: "The change in revenue against the comparison period identified in the notes." },
  net_margin_pct: { name: "Estimated net margin", meaning: "The share of net revenue remaining after shipping-label costs and processing labor.", caution: "Uses an assumed labor cost and excludes general overhead. This is not final profit." },
  listings_created: { name: "New listings created", meaning: "Items first listed for sale during this month.", unit: "listings" },
  revenue_per_labor_hour: { name: "Revenue generated per hour worked", meaning: "Net online revenue divided by the recorded hours worked.", caution: "Revenue per hour is not profit per hour." },
  listings_per_employee: { name: "Average listings created per employee", meaning: "New listings divided by the employees with recorded work hours.", unit: "listings per employee" },
  days_donation_to_listing: { name: "Average time from donation to listing", meaning: "Average days between donation and listing, for items listed this month." },
  unlisted_backlog: { name: "Items waiting to be listed", meaning: "Items sent to e-commerce but still unlisted at the end of the month.", unit: "items" },
  unsold_inventory_pct: { name: "Unsold listings older than 60 days", meaning: "The share of listings still unsold at month-end that have been open for more than 60 days." },
  avg_selling_price: { name: "Average price per item sold", meaning: "Gross selling price divided by the quantity sold on paid orders. This differs from net revenue." },
  sell_through_rate: { name: "Share of available items sold", meaning: "Items sold this month as a percentage of the items available for sale." },
  sales_per_employee: { name: "Average revenue per employee", meaning: "Net online revenue divided by employees with recorded work hours." },
  top10_categories_revenue: { name: "Revenue from the top 10 categories", meaning: "Combined net revenue of the ten highest-revenue categories. The ranking appears in Categories by revenue." },
  top10_categories_margin: { name: "Margin amount from the top 10 categories", meaning: "Combined margin amount of the ten highest-margin categories. This is an amount, not a percentage.", caution: "Category margin excludes shipping charged to customers; it is not final profit." },
  repeat_buyer_rate: { name: "Buyers who purchased more than once", meaning: "Identified buyers with two or more transactions divided by identified buyers this month. Buyers are tracked within each marketplace." },
  gross_margin_pct: { name: "Revenue remaining after processing labor", meaning: "Net revenue less estimated processing labor cost, as a share of net revenue.", caution: "Shipping costs and general overhead are not deducted here." },
  profit_per_labor_hour: { name: "Estimated remaining amount per hour worked", meaning: "Net revenue less processing labor and net shipping costs, divided by recorded work hours.", caution: "General overhead is not deducted; this is not final profit." },
  items_identified: { name: "Items selected for online selling", meaning: "Items identified for e-commerce during this month.", unit: "items" },
  items_sent_to_ecom: { name: "Items sent to the online-selling team", meaning: "Items sent to e-commerce during this month.", unit: "items" },
  listings_per_day: { name: "Average new listings per calendar day", meaning: "New listings divided by calendar days from month-start through the last recorded listing day.", unit: "listings per day" },
  avg_time_to_list_days: { name: "Average time from arrival to listing", meaning: "Average days from being sent to e-commerce to being listed, for items listed this month." },
  median_sale_price: { name: "Middle selling price per item", meaning: "The middle per-item gross selling price on paid order lines; for an even number of prices, the two middle prices are averaged." },
  days_to_sell: { name: "Average time from listing to sale", meaning: "Average days from listing to sale, for items sold this month." },
  relisted_inventory_pct: { name: "Available items that were relisted", meaning: "The percentage of available items with at least one relisting." },
  sales_by_category: { name: "Revenue across categorized orders", meaning: "Net revenue from orders assigned to a category. See All category performance." },
  margin_by_category: { name: "Margin amount across categorized orders", meaning: "Category net revenue less shipping charged on paid orders. See All category performance.", caution: "This is an amount, not a profit percentage or final profit." },
  units_by_category: { name: "Items sold across categorized orders", meaning: "Quantity sold on paid orders assigned to a category. See All category performance.", unit: "items sold" },
  sell_through_by_category: { name: "Share sold across categorized items", meaning: "Items sold as a share of available items that have a category. See All category performance." },
  asp_by_category: { name: "Average price across categorized sales", meaning: "Gross selling price divided by quantity sold on paid categorized orders. See All category performance." },
  number_of_buyers: { name: "Identified buyers", meaning: "Distinct identified buyers this month, tracked separately within each marketplace.", unit: "buyers" },
  new_buyers: { name: "Buyers making their first recorded purchase", meaning: "Buyers whose first transaction in the available history is this month. This does not prove they have never purchased before.", unit: "buyers" },
  csat: { name: "Average customer satisfaction rating", meaning: "Customer satisfaction across marketplaces, weighted by sample size when available. Each platform's rating scale is retained.", unit: "rating points" },
  nps: { name: "Average recommendation score", meaning: "The average Net Promoter Score across marketplaces, weighted by sample size when available. The scale runs from -100 to 100.", unit: "score points" },
  marketplace_conversion: { name: "Average marketplace conversion", meaning: "The average conversion percentage reported by marketplaces, weighted by sample size when available. See Marketplace information." },
};

export function netMarginCostBasis(kpi: ReportKpi): string {
  return /other marketplace\/shipping-account charges/i.test(kpi.note ?? "")
    ? "shipping labels, other marketplace and shipping-account charges, and assumed processing labor"
    : "net shipping costs and assumed processing labor";
}

export function kpiMeaning(kpi: ReportKpi): Meaning {
  if (kpi.id === "net_margin_pct") return { ...meanings.net_margin_pct,
    meaning: `The share of net revenue remaining after ${netMarginCostBasis(kpi)}.` };
  return meanings[kpi.id] ?? { name: kpi.label, meaning: "This measure is supplied by the reporting source. Consult the accompanying notes for its definition." };
}

export const pillarNames: Record<ReportKpi["pillar"], string> = {
  financial: "Financial results", productivity: "Listing & productivity", inventory: "Inventory flow",
  sales: "Sales effectiveness", category_customer: "Categories & customers",
};

// Preserve every decimal supplied by the source, including exponential notation.
// Formatting adds separators and shifts cents; it never rounds a KPI.
function decimalParts(value: number): { sign: string; digits: string; point: number } {
  if (!Number.isFinite(value)) throw new Error("Report values must be finite");
  const [mantissa, exponent = "0"] = String(Math.abs(value)).split(/[eE]/);
  const [integer, fraction = ""] = mantissa.split(".");
  return { sign: value < 0 ? "-" : "", digits: integer + fraction, point: integer.length + Number(exponent) };
}
export function formatReportNumber(value: number, decimalShift = 0, minimumDecimals = 0): string {
  const { sign, digits, point: originalPoint } = decimalParts(value);
  const point = originalPoint + decimalShift;
  let integer = point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0");
  let fraction = point < 0 ? "0".repeat(-point) + digits : point < digits.length ? digits.slice(Math.max(point, 0)) : "";
  integer = integer.replace(/^0+(?=\d)/, "");
  fraction = fraction.padEnd(minimumDecimals, "0");
  return sign + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? "." + fraction : "");
}
export function formatReportValue(value: number | null, unit: KpiUnit): string {
  if (value === null) return "Not available";
  if (unit === "cents" || unit === "cents_per_hour") return formatReportNumber(value, -2, 2);
  return formatReportNumber(value) + (unit === "percent" ? "%" : "");
}
export function reportUnit(kpi: ReportKpi, compact = false): string {
  const meaning = kpiMeaning(kpi);
  if (kpi.unit === "percent") return "";
  if (kpi.unit === "cents_per_hour") return compact ? "amount per hour" : "currency units per hour worked";
  if (kpi.unit === "cents") return compact ? "amount" : kpi.id === "sales_per_employee" ? "currency units per employee" : "currency units";
  if (kpi.unit === "days") return "days on average";
  return meaning.unit ?? (kpi.unit === "count" ? "recorded total" : "measure; unit not explained by source");
}
export function dataLabel(kpi: ReportKpi): string {
  if (kpi.value === null || kpi.status === "awaiting_data") return "Data unavailable";
  return kpi.status === "simulated" ? "Simulated inputs" : "Calculated";
}
export function monthName(period: string): string {
  const date = new Date(`${period}-01T12:00:00Z`);
  return Number.isNaN(date.valueOf()) ? period : date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
export function dateName(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function growthBasis(kpi: ReportKpi, priorMonth: string): string {
  const annual = kpi.note?.match(/YoY vs (\d{4}-\d{2})/i);
  if (annual) return `Revenue change compared with ${monthName(annual[1])}`;
  if (/MoM:/i.test(kpi.note ?? "")) return `Revenue change compared with ${monthName(priorMonth)}; same-month prior-year data is unavailable`;
  return "Revenue change; comparison period not provided";
}

// Short table labels; full definitions remain available in the HTML reference.
const compactAdditionalNames: Record<string, string> = {
  gross_margin_pct: "Share left after labor",
  profit_per_labor_hour: "Amount left per hour",
  items_identified: "Items selected online",
  items_sent_to_ecom: "Items sent to online team",
  listings_per_day: "Listings per calendar day",
  avg_time_to_list_days: "Days: arrival to listing",
  median_sale_price: "Median item price",
  days_to_sell: "Average days to sell",
  relisted_inventory_pct: "Available items relisted",
  sales_by_category: "Revenue by category",
  margin_by_category: "Margin amount by category",
  units_by_category: "Items sold by category",
  sell_through_by_category: "Category share sold",
  asp_by_category: "Average price by category",
  number_of_buyers: "Identified buyers",
  new_buyers: "New buyers (on record)",
  csat: "Average customer rating",
  nps: "Recommendation score",
  marketplace_conversion: "Marketplace conversion",
};

export function reportName(kpi: ReportKpi, compact = false): string {
  return compact ? compactAdditionalNames[kpi.id] ?? kpiMeaning(kpi).name : kpiMeaning(kpi).name;
}
