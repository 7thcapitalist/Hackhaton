/**
 * The only data the seed still inserts directly: no source file exists for it
 * yet (docs/lanes/joao-database.md "items and labor_hours").
 *
 * - items: one per sold order line of the mock model (2026 window), with a
 *   donated → identified → sent → listed → sold timeline, plus open listings
 *   and an unlisted backlog. Feeds days to list, sell-through, backlog.
 * - labor_hours: pseudonymous employees per day. Feeds revenue per labor hour.
 *
 * Deterministic (own seed). Marked synthetic by having no ingest run; the
 * scorecard shows the KPIs that use them as "simulated".
 */
import type { NewItem, NewLaborHour } from "../../src/db/schema";
import { dateRange, daysBetween, localToUtc } from "../../src/lib/views/dates";
import { END_DATE, START_DATE, type MockModel } from "../mock/model";
import { Rng } from "./prng";

const SEED = 20261004;
const LISTERS = Array.from({ length: 6 }, (_, i) => `Lister ${String(i + 1).padStart(2, "0")}`);
const EMPLOYEES: { name: string; team: string }[] = [
  ...LISTERS.map((name) => ({ name, team: "Listing" })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `Processor ${String(i + 1).padStart(2, "0")}`, team: "Processing" })),
  ...Array.from({ length: 3 }, (_, i) => ({ name: `Shipper ${String(i + 1).padStart(2, "0")}`, team: "Shipping" })),
];
const ALL_CATEGORIES: [string, number][] = [
  ["Books", 22], ["Clothing", 16], ["Collectibles", 10], ["Electronics", 9], ["Media", 8],
  ["Jewelry", 6], ["Home Decor", 7], ["Shoes", 5], ["Handbags", 4], ["Kitchen", 4],
  ["Toys", 3], ["Art", 2], ["Watches", 2], ["Sporting Goods", 2],
];
const SOURCE_OF_STREAM: Record<string, string> = {
  shopgoodwill: "shopgoodwill", amazon: "amazon", ebay: "ebay", goodwill_books: "upright", upright_other: "upright",
};

const iso = (d: Date) => d.toISOString();
const priceEnding99 = (cents: number) => Math.max(199, Math.round(cents / 100) * 100 - 1);

export function syntheticOps(model: MockModel): { items: NewItem[]; laborHours: NewLaborHour[] } {
  const rng = new Rng(SEED);
  const items: NewItem[] = [];
  let itemSeq = 0;
  const nextId = () => `item-${String(++itemSeq).padStart(6, "0")}`;

  // Sold items: one per order line in the 2026 window.
  for (const o of model.orders) {
    if (o.businessDate < START_DATE) continue;
    const daysToSell = Math.min(120, Math.round(rng.logNormal(9, 0.8)));
    const listedAt = new Date(o.ts.getTime() - daysToSell * 86_400_000 - rng.int(0, 36_000) * 1000);
    const sentAt = new Date(listedAt.getTime() - rng.logNormal(4, 0.7) * 86_400_000);
    const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * 86_400_000);
    const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * 86_400_000);
    const sold = o.status !== "cancelled";
    items.push({
      id: nextId(),
      ingestRunId: null,
      category: o.category,
      donatedAt: iso(donatedAt),
      identifiedAt: iso(identifiedAt),
      sentToEcomAt: iso(sentAt),
      listedAt: iso(listedAt),
      soldAt: sold ? iso(o.ts) : null,
      listedBy: rng.pick(LISTERS),
      channelSourceId: SOURCE_OF_STREAM[o.stream] ?? null,
      listPriceCents: Math.round(o.unitCents * (1 + rng.float() * 0.2)),
      salePriceCents: sold ? o.unitCents : null,
      relistCount: daysToSell > 30 ? 1 : 0,
    });
  }

  // Listings still open today: recent ones dominate.
  const unsoldSources: [string, number][] = [["shopgoodwill", 40], ["amazon", 30], ["ebay", 20], ["upright", 10]];
  for (const d of dateRange("2026-05-01", END_DATE)) {
    const n = rng.count(70 * Math.exp(-daysBetween(d, END_DATE) / 50));
    for (let i = 0; i < n; i++) {
      const listedAt = localToUtc(d, rng.int(8 * 3600, 18 * 3600));
      const sentAt = new Date(listedAt.getTime() - rng.logNormal(4, 0.7) * 86_400_000);
      const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * 86_400_000);
      const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * 86_400_000);
      items.push({
        id: nextId(),
        ingestRunId: null,
        category: rng.weighted(ALL_CATEGORIES),
        donatedAt: iso(donatedAt),
        identifiedAt: iso(identifiedAt),
        sentToEcomAt: iso(sentAt),
        listedAt: iso(listedAt),
        soldAt: null,
        listedBy: rng.pick(LISTERS),
        channelSourceId: rng.weighted(unsoldSources),
        listPriceCents: priceEnding99(rng.logNormal(2_600, 0.6)),
        salePriceCents: null,
        relistCount: Math.floor(daysBetween(d, END_DATE) / 30),
      });
    }
  }
  // Sent to e-commerce but not listed yet (backlog).
  for (const d of dateRange("2026-09-05", END_DATE)) {
    const n = rng.count(30);
    for (let i = 0; i < n; i++) {
      const sentAt = localToUtc(d, rng.int(8 * 3600, 17 * 3600));
      const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * 86_400_000);
      const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * 86_400_000);
      items.push({
        id: nextId(),
        ingestRunId: null,
        category: rng.weighted(ALL_CATEGORIES),
        donatedAt: iso(donatedAt),
        identifiedAt: iso(identifiedAt),
        sentToEcomAt: iso(sentAt),
        listedAt: null,
        soldAt: null,
        listedBy: null,
        channelSourceId: null,
        listPriceCents: null,
        salePriceCents: null,
        relistCount: 0,
      });
    }
  }

  const laborHours: NewLaborHour[] = [];
  let laborSeq = 0;
  for (const d of dateRange(START_DATE, END_DATE)) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    for (const e of EMPLOYEES) {
      if (!rng.chance(weekday === 6 ? 0.4 : 0.88)) continue;
      laborHours.push({
        id: `lh-${String(++laborSeq).padStart(6, "0")}`,
        ingestRunId: null,
        employee: e.name,
        team: e.team,
        workDate: d,
        hours: Math.max(3, Math.round(rng.normal(7.5, 0.7) * 4) / 4),
      });
    }
  }
  return { items, laborHours };
}
