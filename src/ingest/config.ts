/**
 * Source and channel config rows (goodwill-problem.md slide 38, research.md §6.1-6.2).
 *
 * `ensureConfig()` inserts them if missing, so ingest never hits a foreign-key
 * error on a fresh database. It never overwrites a row that already exists
 * (the seed script or a human may have edited names/owners). Ids must stay
 * identical to the seed script's.
 */
import type { Db } from "@/db/client";
import { channels, sources, type NewChannel, type NewSource } from "@/db/schema";

export type ChannelId = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other";

/**
 * revenue_authority: which source wins when two sources report the same order
 * (same dedupe_key). Decision (Joao, 2026-10-03): Upright is the source of
 * truth for orders, because it covers ShopGoodwill, eBay and other channels in
 * one export, so Goodwill depends on fewer reports. Upright = 1, every other
 * source = 0. Marketplace files still load: they fill orders Upright doesn't
 * list, plus fees, payouts and refunds. See ingest.ts.
 */
export const SOURCE_CONFIG: NewSource[] = [
  {
    id: "shopgoodwill",
    name: "ShopGoodwill",
    kind: "marketplace",
    channelGroup: "ShopGoodwill",
    acquisition: "Seller portal: filter year/month; Period 1 periodic only; Period 3 all reports",
    revenueAuthority: 0,
  },
  {
    id: "amazon",
    name: "Amazon",
    kind: "marketplace",
    channelGroup: "Amazon",
    acquisition: "Seller Central payments summary: request/refresh/download",
    revenueAuthority: 0,
  },
  {
    id: "ebay",
    name: "eBay",
    kind: "marketplace",
    channelGroup: "eBay",
    acquisition: "Seller Center listing sales report: change date, generate/download",
    revenueAuthority: 0,
  },
  {
    id: "cashmonkey",
    name: "Cash Monkey",
    kind: "marketplace",
    channelGroup: "Other e-commerce",
    acquisition: "Orders, full month: submit/download CSV; save as Excel",
    revenueAuthority: 0,
  },
  {
    id: "upright",
    name: "Upright",
    kind: "marketplace",
    channelGroup: null, // spans channels; pulse uses orders.channel
    acquisition: "Paid order items, full month: generate; email delivery; save as Excel",
    revenueAuthority: 1, // Upright is the source of truth for orders (Joao, 2026-10-03)
  },
  {
    id: "jewelry",
    name: "Jewelry",
    kind: "marketplace",
    channelGroup: "Other e-commerce",
    acquisition: "Jewelry Report: request report; Co-Pivot populates Supplier",
    revenueAuthority: 0,
  },
  {
    id: "shipping_osm_pb_easypost",
    name: "OSM / PB / EasyPost",
    kind: "shipping",
    channelGroup: null,
    acquisition: "Shipping amounts: 1st Source acct 0101, GL 10009",
    revenueAuthority: 0,
  },
  {
    id: "fedex",
    name: "FedEx",
    kind: "shipping",
    channelGroup: null,
    acquisition: "Shipping charges + refunds: GL 40356, Dept 180, V00122, net BNKDEPOSIT refunds",
    revenueAuthority: 0,
  },
  {
    id: "goodwill_books",
    name: "Goodwill Books",
    kind: "statement",
    channelGroup: "Other e-commerce",
    acquisition: "Prior-month payment statement: monthly email attachment",
    revenueAuthority: 0,
  },
  // Ops sources: no revenue. They feed the item-pipeline, labor and customer KPIs.
  {
    id: "production_tracking",
    name: "Production tracking",
    kind: "internal",
    channelGroup: null,
    acquisition: "Production-tracking export: donated / identified / sent-to-e-com timestamps per item tag",
    revenueAuthority: 0,
  },
  {
    id: "upright_inventory",
    name: "Upright Lister inventory",
    kind: "internal",
    channelGroup: null,
    acquisition: "Upright Lister inventory/products export: listed / sold timestamps, lister, price, relists",
    revenueAuthority: 0,
  },
  {
    id: "timekeeping",
    name: "Timekeeping",
    kind: "internal",
    channelGroup: null,
    acquisition: "Payroll timecard export (REG/OT hours per employee id and day); e-commerce departments only",
    revenueAuthority: 0,
  },
  {
    id: "marketplace_ratings",
    name: "Marketplace ratings",
    kind: "internal",
    channelGroup: null,
    acquisition: "Monthly CSAT / NPS / conversion / seller rating from each marketplace's seller dashboard",
    revenueAuthority: 0,
  },
  {
    id: "bank_1st_source",
    name: "1st Source bank (acct 0101)",
    kind: "statement",
    channelGroup: null,
    acquisition: "1st Source online banking CSV export, acct 0101; informational (shipping debits, deposits) until bank reconciliation",
    revenueAuthority: 0,
  },
];

export const CHANNEL_CONFIG: (NewChannel & { id: ChannelId })[] = [
  { id: "shopgoodwill", name: "ShopGoodwill", pulseGroup: "ShopGoodwill", sortOrder: 1 },
  { id: "amazon", name: "Amazon", pulseGroup: "Amazon", sortOrder: 2 },
  { id: "ebay", name: "eBay", pulseGroup: "eBay", sortOrder: 3 },
  { id: "goodwill_books", name: "GoodwillBooks", pulseGroup: "Other e-commerce", sortOrder: 4 },
  { id: "other", name: "Other", pulseGroup: "Other e-commerce", sortOrder: 5 },
];

export const CHANNEL_IDS = CHANNEL_CONFIG.map((c) => c.id);

/**
 * Sources whose own file covers a channel. A channel is also covered on a day
 * if any ingested order (e.g. from Upright) carries that channel.
 */
export const CHANNEL_SOURCES: Record<ChannelId, string[]> = {
  shopgoodwill: ["shopgoodwill"],
  amazon: ["amazon"],
  ebay: ["ebay"],
  goodwill_books: ["goodwill_books"],
  other: ["cashmonkey", "jewelry"],
};

/** Sources that can deliver a nightly file (checked by the daily completeness check). */
export const DAILY_SOURCES = ["shopgoodwill", "amazon", "ebay", "upright"];

const ensured = new WeakSet<object>();

/** Insert missing sources/channels rows. Idempotent; never overwrites. */
export async function ensureConfig(db: Db): Promise<void> {
  if (ensured.has(db)) return;
  await db.batch([
    db.insert(sources).values(SOURCE_CONFIG).onConflictDoNothing(),
    db.insert(channels).values(CHANNEL_CONFIG).onConflictDoNothing(),
  ]);
  ensured.add(db);
}
