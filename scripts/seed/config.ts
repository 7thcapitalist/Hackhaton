/**
 * Configuration rows for the seed: the 9 source workflows (slide 38), the
 * sales channels and their nightly pulse rows (slide 31), and KPI targets.
 *
 * sources.config_json carries:
 *   channels: the sales channels this source reports orders for (used by the
 *             pulse to decide "missing" vs "ok" for a channel on a day)
 *   cadence:  "daily" (a file per business day, ingest_runs.business_date set),
 *             "weekly" (a file per invoice week) or "monthly" (month-end file,
 *             ingest_runs.period set). Must match src/ingest/config.ts
 *             SOURCE_CADENCE: every source at the highest frequency its real
 *             system supports.
 *   feeds:    sub-feeds with their own cadence (OSM invoices are weekly inside
 *             the shipping source)
 * Owners are roles, not people (no real staff names in the repo).
 */
import type { NewChannel, NewKpiTarget, NewSource } from "../../src/db/schema";
import type { SourceCadence } from "../../src/ingest/config";

export type { SourceCadence };
export interface SourceConfig {
  channels: string[];
  cadence: SourceCadence;
  feeds?: Record<string, SourceCadence>;
}

const cfg = (c: SourceConfig) => JSON.stringify(c);

export const SOURCES: NewSource[] = [
  {
    id: "shopgoodwill",
    name: "ShopGoodwill",
    kind: "marketplace",
    channelGroup: "ShopGoodwill",
    acquisition: "Periodic marketplace reports: filter year/month; Period 1 periodic only; Period 3 all reports",
    owner: "E-commerce manager",
    revenueAuthority: 0,
    configJson: cfg({ channels: ["shopgoodwill"], cadence: "daily" }),
  },
  {
    id: "amazon",
    name: "Amazon",
    kind: "marketplace",
    channelGroup: "Amazon",
    acquisition: "Payments summary: Seller Central, request/refresh/download",
    owner: "E-commerce manager",
    revenueAuthority: 0,
    configJson: cfg({ channels: ["amazon"], cadence: "daily" }),
  },
  {
    id: "ebay",
    name: "eBay",
    kind: "marketplace",
    channelGroup: "eBay",
    acquisition: "Listing sales report: Seller Center, change date, generate/download",
    owner: "E-commerce manager",
    revenueAuthority: 0,
    configJson: cfg({ channels: ["ebay"], cadence: "daily" }),
  },
  {
    id: "cashmonkey",
    name: "Cash Monkey",
    kind: "marketplace",
    channelGroup: "Other e-commerce",
    acquisition: "Orders, full month: submit/download CSV; save as Excel",
    owner: "Finance (accounting clerk)",
    revenueAuthority: 0,
    configJson: cfg({ channels: ["other"], cadence: "daily" }),
  },
  {
    id: "upright",
    name: "Upright",
    kind: "marketplace",
    channelGroup: "Other e-commerce",
    // Slide 38 says full month; for the nightly pulse we assume a daily pull.
    acquisition: "Paid order items: generate; email delivery; save as Excel",
    owner: "E-commerce manager",
    revenueAuthority: 1, // Upright is the source of truth for orders (Joao, 2026-10-03)
    configJson: cfg({ channels: ["other", "ebay"], cadence: "daily" }),
  },
  {
    id: "jewelry",
    name: "Jewelry",
    kind: "statement",
    channelGroup: null,
    acquisition: "Jewelry Report: request report; Co-Pivot populates Supplier",
    owner: "Finance (accounting clerk)",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
  {
    id: "shipping_osm_pb_easypost",
    name: "OSM / PB / EasyPost",
    kind: "shipping",
    channelGroup: null,
    acquisition: "Shipping amounts: 1st Source acct 0101, GL 10009",
    owner: "Finance (AP)",
    configJson: cfg({ channels: [], cadence: "daily", feeds: { easypost: "daily", pitney_bowes: "daily", osm: "weekly" } }),
  },
  {
    id: "fedex",
    name: "FedEx",
    kind: "shipping",
    channelGroup: null,
    acquisition: "Shipping charges + refunds: BC GL 40356, Dept 180, V00122, net BNKDEPOSIT refunds",
    owner: "Finance (AP)",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
  {
    id: "goodwill_books",
    name: "Goodwill Books",
    kind: "statement",
    channelGroup: "Other e-commerce",
    acquisition: "Prior-month payment statement: monthly email attachment",
    owner: "Finance (accounting clerk)",
    revenueAuthority: 0,
    configJson: cfg({ channels: ["goodwill_books"], cadence: "monthly" }),
  },
  // Ops sources (no revenue): item lifecycle, labor, customer ratings, bank statement.
  {
    id: "production_tracking",
    name: "Production tracking",
    kind: "internal",
    channelGroup: null,
    acquisition: "Production-tracking export: donated / identified / sent-to-e-com timestamps per item tag",
    owner: "E-commerce manager",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
  {
    id: "upright_inventory",
    name: "Upright Lister inventory",
    kind: "internal",
    channelGroup: null,
    acquisition: "Upright Lister inventory/products export: listed / sold timestamps, lister, price, relists",
    owner: "E-commerce manager",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
  {
    id: "timekeeping",
    name: "Timekeeping",
    kind: "internal",
    channelGroup: null,
    acquisition: "Payroll timecard export (REG/OT hours per employee id and day); e-commerce departments only",
    owner: "HR / payroll",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
  {
    id: "marketplace_ratings",
    name: "Marketplace ratings",
    kind: "internal",
    channelGroup: null,
    acquisition: "Monthly CSAT / NPS / conversion / seller rating from each marketplace's seller dashboard",
    owner: "E-commerce manager",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
  {
    id: "bank_1st_source",
    name: "1st Source bank (acct 0101)",
    kind: "statement",
    channelGroup: null,
    acquisition: "1st Source online banking CSV export, acct 0101; informational until bank reconciliation",
    owner: "Finance (AP)",
    configJson: cfg({ channels: [], cadence: "daily" }),
  },
];

/**
 * Pulse rows group channels by pulse_group. The row's channelId is the first
 * channel of the group by sort_order, so "other" (4) represents the
 * "Other e-commerce" row that also includes goodwill_books (5).
 */
export const CHANNELS: NewChannel[] = [
  { id: "shopgoodwill", name: "ShopGoodwill", pulseGroup: "ShopGoodwill", sortOrder: 1 },
  { id: "amazon", name: "Amazon", pulseGroup: "Amazon", sortOrder: 2 },
  { id: "ebay", name: "eBay", pulseGroup: "eBay", sortOrder: 3 },
  { id: "other", name: "Other e-commerce", pulseGroup: "Other e-commerce", sortOrder: 4 },
  { id: "goodwill_books", name: "Goodwill Books", pulseGroup: "Other e-commerce", sortOrder: 5 },
];

/** Plausible monthly targets (placeholders until Goodwill gives real ones). */
const TARGETS: Record<string, number> = {
  total_revenue: 14_500_000, // cents = $145k/month
  revenue_growth_pct: 3,
  net_margin_pct: 55, // net of processing labor (labor hours × $18/h) since the KPI update
  gross_margin_pct: 75,
  listings_created: 5_000,
  revenue_per_labor_hour: 7_000, // cents per hour = $70/h
  listings_per_employee: 400,
  days_donation_to_listing: 12,
  unlisted_backlog: 800,
  unsold_inventory_pct: 20,
  avg_selling_price: 2_700, // cents
  sell_through_rate: 55,
  sales_per_employee: 1_100_000, // cents per employee per month
  repeat_buyer_rate: 30,
};

export const KPI_TARGET_PERIODS = ["2026-08", "2026-09", "2026-10"];

export const KPI_TARGETS: NewKpiTarget[] = KPI_TARGET_PERIODS.flatMap((period) =>
  Object.entries(TARGETS).map(([kpiKey, targetValue]) => ({
    id: `target-${kpiKey}-${period}`,
    kpiKey,
    period,
    targetValue,
  })),
);
