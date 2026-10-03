// Presentation-only metadata for pulse channels — labels, which real orders.channel
// values back each pulse row, and which of the 9 source workflows feed each one.
// Every number on screen still comes from the database (src/lib/views); this file
// only names things, straight from scripts/seed/config.ts (the committed config,
// not invented). Safe to import from both server and client components: no DB access.
import type { ChannelId } from "./types";

export type ChannelMeta = { id: ChannelId; label: string; sublabel: string };

/** One row per pulse group (channels.pulse_group in the schema). */
export const CHANNELS: ChannelMeta[] = [
  { id: "shopgoodwill", label: "ShopGoodwill", sublabel: "shopgoodwill.com auctions" },
  { id: "amazon", label: "Amazon", sublabel: "Seller Central settlement" },
  { id: "ebay", label: "eBay", sublabel: "Seller Hub transactions" },
  { id: "other", label: "Other e-comm", sublabel: "Cash Monkey · Upright · Goodwill Books" },
];

/** A friendlier label for any real ChannelId, including ones that only ever show up
 * inside the "Other e-comm" group (e.g. a Goodwill Books order line). */
export const CHANNEL_LABEL: Record<ChannelId, string> = {
  shopgoodwill: "ShopGoodwill",
  amazon: "Amazon",
  ebay: "eBay",
  other: "Other e-comm",
  goodwill_books: "Goodwill Books",
};

/** Which real ChannelId values are folded into one pulse row (scripts/seed/config.ts:
 * "other" (sortOrder 4) and "goodwill_books" (sortOrder 5) share the pulse_group
 * "Other e-commerce", so the pulse's "other" row is really both). */
export const GROUP_MEMBERS: Record<ChannelId, ChannelId[]> = {
  shopgoodwill: ["shopgoodwill"],
  amazon: ["amazon"],
  ebay: ["ebay"],
  other: ["other", "goodwill_books"],
  goodwill_books: ["goodwill_books"],
};

/** Which of the 9 source workflows post orders to each real ChannelId
 * (scripts/seed/config.ts SOURCES[].configJson.channels, inverted). Upright feeds
 * both "other" and "ebay" — it's the system of record for some eBay-labeled orders too. */
export const CHANNEL_SOURCES: Record<ChannelId, string[]> = {
  shopgoodwill: ["shopgoodwill"],
  amazon: ["amazon"],
  ebay: ["ebay", "upright"],
  other: ["cashmonkey", "upright"],
  goodwill_books: ["goodwill_books"],
};

/** Every source id that can post to a pulse row (union of its members' CHANNEL_SOURCES). */
export function sourcesForRow(channelId: ChannelId): string[] {
  const members = GROUP_MEMBERS[channelId] ?? [channelId];
  return [...new Set(members.flatMap((c) => CHANNEL_SOURCES[c] ?? []))];
}
