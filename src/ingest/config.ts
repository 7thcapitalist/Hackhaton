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
 * revenue_authority = 1 for the channel-native report (the marketplace's own
 * export), 0 for aggregators like Upright that re-report orders from other
 * channels. When two sources report the same dedupe_key, the authoritative
 * one wins (see ingest.ts). TBC with Amanda which source is the revenue truth.
 */
export const SOURCE_CONFIG: NewSource[] = [
  {
    id: "shopgoodwill",
    name: "ShopGoodwill",
    kind: "marketplace",
    channelGroup: "ShopGoodwill",
    acquisition: "Seller portal: filter year/month; Period 1 periodic only; Period 3 all reports",
    revenueAuthority: 1,
  },
  {
    id: "amazon",
    name: "Amazon",
    kind: "marketplace",
    channelGroup: "Amazon",
    acquisition: "Seller Central payments summary: request/refresh/download",
    revenueAuthority: 1,
  },
  {
    id: "ebay",
    name: "eBay",
    kind: "marketplace",
    channelGroup: "eBay",
    acquisition: "Seller Center listing sales report: change date, generate/download",
    revenueAuthority: 1,
  },
  {
    id: "cashmonkey",
    name: "Cash Monkey",
    kind: "marketplace",
    channelGroup: "Other e-commerce",
    acquisition: "Orders, full month: submit/download CSV; save as Excel",
    revenueAuthority: 1,
  },
  {
    id: "upright",
    name: "Upright",
    kind: "marketplace",
    channelGroup: null, // spans channels; pulse uses orders.channel
    acquisition: "Paid order items, full month: generate; email delivery; save as Excel",
    revenueAuthority: 0,
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
    revenueAuthority: 1,
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
