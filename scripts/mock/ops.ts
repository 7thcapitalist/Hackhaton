/**
 * Operations truth behind the 5 "ops" mock exports (item lifecycle, labor,
 * marketplace ratings, bank statement). Derived from the sales model, with its
 * OWN random stream (OPS_SEED), so adding it does not change a single byte of
 * the marketplace files.
 *
 * - items: one per 2026 order line (id = the order's SKU, so sold items match
 *   the orders), plus open listings and an unlisted backlog. Timeline:
 *   donated → identified → sent to e-com (production tracking) → listed →
 *   sold (Upright Lister).
 * - employees: pseudonyms only (EMP-1001…), e-commerce departments plus a few
 *   store/warehouse employees that the timekeeping parser must filter out.
 *   Listers are the Listing department; `listed_by` uses the same pseudonym.
 * - laborDays: one row per employee per worked day (regular + overtime).
 * - ratings: monthly per channel, prior year and current year.
 * - bank: 1st Source acct 0101 lines (deposits and withdrawals with memos).
 *
 * No real names, no buyer data. Pure and deterministic.
 */
import { addDays, dateRange, daysBetween, localToUtc } from "../../src/lib/views/dates";
import { Rng } from "../seed/prng";
import type { MockModel, Shipment } from "./model";

const OPS_SEED = 20261004;
const OPS_START = "2026-08-01";
const OPS_END = "2026-10-03";

export interface OpsItem {
  id: string;
  category: string;
  donatedAt: Date;
  identifiedAt: Date;
  sentAt: Date;
  listedAt: Date | null;
  soldAt: Date | null;
  listedBy: string | null;
  /** Upright "Marketplace" value. */
  marketplace: string | null;
  listPriceCents: number | null;
  salePriceCents: number | null;
  relistCount: number;
  donationSite: string;
}

export interface OpsEmployee {
  id: string;
  department: string;
  jobTitle: string;
  /** E-commerce departments count toward labor KPIs; others are filtered out. */
  ecommerce: boolean;
}

export interface OpsLaborDay {
  employee: string;
  department: string;
  jobTitle: string;
  date: string;
  regularHours: number;
  overtimeHours: number;
}

export interface OpsRating {
  period: string;
  marketplace: string;
  sellerRating: number | null;
  csat: number | null;
  csatResponses: number | null;
  nps: number | null;
  npsResponses: number | null;
  conversionPct: number | null;
  sessions: number | null;
}

export interface OpsBankLine {
  date: string;
  description: string;
  /** + = deposit (credit to the account), − = withdrawal. */
  amountCents: number;
  type: "ACH CREDIT" | "ACH DEBIT" | "BNKDEPOSIT" | "POS DEBIT" | "SERVICE CHARGE";
  reference: string;
}

export interface OpsModel {
  items: OpsItem[];
  employees: OpsEmployee[];
  laborDays: OpsLaborDay[];
  ratings: OpsRating[];
  bank: OpsBankLine[];
  /** Months that get monthly ops files. */
  itemPeriods: string[];
  ratingPeriods: string[];
  bankPeriods: string[];
}

const ALL_CATEGORIES: [string, number][] = [
  ["Books", 22], ["Clothing", 16], ["Collectibles", 10], ["Electronics", 9], ["Media", 8],
  ["Jewelry", 6], ["Home Decor", 7], ["Shoes", 5], ["Handbags", 4], ["Kitchen", 4],
  ["Toys", 3], ["Art", 2], ["Watches", 2], ["Sporting Goods", 2],
];
const MARKETPLACE_OF_STREAM: Record<string, string> = {
  shopgoodwill: "ShopGoodwill", amazon: "Amazon", ebay: "eBay", goodwill_books: "GoodwillBooks", upright_other: "",
};
/**
 * Mean days from listing to sale, per channel (public benchmarks): ShopGoodwill
 * auctions close in about a week, eBay fixed price ~25 days, Amazon books sit
 * ~45 days (other Amazon items ~15), Goodwill Books and other channels ~15.
 */
function meanDaysToSell(stream: string, category: string): number {
  switch (stream) {
    case "shopgoodwill": return 8;
    case "ebay": return 25;
    case "amazon": return category === "Books" ? 45 : 15;
    default: return 15;
  }
}
/** logNormal(median, 0.6) has mean = median x e^(0.6^2/2). */
const LOGNORMAL_MEAN_FACTOR = Math.exp(0.18);
const SITES = ["Store 04", "Store 07", "Store 12", "Outlet DC", "Donation Center 02"];
const priceEnding99 = (cents: number) => Math.max(199, Math.round(cents / 100) * 100 - 1);

function employees(): OpsEmployee[] {
  const out: OpsEmployee[] = [];
  let n = 1000;
  const add = (count: number, department: string, jobTitle: string, ecommerce: boolean) => {
    for (let i = 0; i < count; i++) out.push({ id: `EMP-${++n}`, department, jobTitle, ecommerce });
  };
  add(6, "E-Commerce Listing", "E-Commerce Lister", true);
  add(4, "E-Commerce Processing", "E-Commerce Processor", true);
  add(3, "E-Commerce Shipping", "Shipping Associate", true);
  add(3, "Retail Store 04", "Retail Associate", false);
  add(2, "Outlet DC Warehouse", "Warehouse Associate", false);
  return out;
}

export function buildOps(model: Omit<MockModel, "ops">, ratingPeriods: readonly string[]): OpsModel {
  const rng = new Rng(OPS_SEED);
  const emps = employees();
  const listers = emps.filter((e) => e.department === "E-Commerce Listing").map((e) => e.id);
  const items: OpsItem[] = [];
  const day = 86_400_000;

  const upstream = (sentAt: Date) => {
    const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * day);
    const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * day);
    return { identifiedAt, donatedAt, donationSite: rng.pick(SITES) };
  };

  // Sold (or cancelled) items: one per 2026 order line; id = the order's SKU.
  for (const o of model.orders) {
    if (o.businessDate < OPS_START) continue;
    const daysToSell = Math.min(180, Math.round(rng.logNormal(meanDaysToSell(o.stream, o.category) / LOGNORMAL_MEAN_FACTOR, 0.6)));
    const listedAt = new Date(o.ts.getTime() - daysToSell * day - rng.int(0, 36_000) * 1000);
    const sentAt = new Date(listedAt.getTime() - rng.logNormal(4, 0.7) * day);
    const sold = o.status !== "cancelled";
    items.push({
      id: o.sku,
      category: o.category,
      ...upstream(sentAt),
      sentAt,
      listedAt,
      soldAt: sold ? o.ts : null,
      listedBy: rng.pick(listers),
      marketplace: MARKETPLACE_OF_STREAM[o.stream] || o.uprightChannel,
      listPriceCents: Math.round(o.unitCents * (1 + rng.float() * 0.2)),
      salePriceCents: sold ? o.unitCents : null,
      relistCount: daysToSell > 30 ? 1 : 0,
    });
  }

  // Listings still open: recent ones dominate.
  const openMarkets: [string, number][] = [["ShopGoodwill", 40], ["Amazon", 30], ["eBay", 20], ["Mercari", 10]];
  let open = 0;
  for (const d of dateRange("2026-05-01", OPS_END)) {
    const n = rng.count(70 * Math.exp(-daysBetween(d, OPS_END) / 50));
    for (let i = 0; i < n; i++) {
      const listedAt = localToUtc(d, rng.int(8 * 3600, 18 * 3600));
      const sentAt = new Date(listedAt.getTime() - rng.logNormal(4, 0.7) * day);
      items.push({
        id: `UL-${String(++open).padStart(6, "0")}`,
        category: rng.weighted(ALL_CATEGORIES),
        ...upstream(sentAt),
        sentAt,
        listedAt,
        soldAt: null,
        listedBy: rng.pick(listers),
        marketplace: rng.weighted(openMarkets),
        listPriceCents: priceEnding99(rng.logNormal(2_600, 0.6)),
        salePriceCents: null,
        relistCount: Math.floor(daysBetween(d, OPS_END) / 30),
      });
    }
  }
  // Sent to e-commerce, not listed yet (backlog): only in production tracking.
  let backlog = 0;
  for (const d of dateRange("2026-09-05", OPS_END)) {
    const n = rng.count(30);
    for (let i = 0; i < n; i++) {
      const sentAt = localToUtc(d, rng.int(8 * 3600, 17 * 3600));
      items.push({
        id: `PT-${String(++backlog).padStart(6, "0")}`,
        category: rng.weighted(ALL_CATEGORIES),
        ...upstream(sentAt),
        sentAt,
        listedAt: null,
        soldAt: null,
        listedBy: null,
        marketplace: null,
        listPriceCents: null,
        salePriceCents: null,
        relistCount: 0,
      });
    }
  }

  // Labor: Mon-Sat; e-commerce staff plus store/warehouse staff (filtered by the parser).
  // Listing hours follow listing volume: busier days → more overtime for listers.
  const listedPerDay = new Map<string, number>();
  for (const it of items) {
    if (!it.listedAt) continue;
    const d = it.listedAt.toISOString().slice(0, 10);
    listedPerDay.set(d, (listedPerDay.get(d) ?? 0) + 1);
  }
  const laborDays: OpsLaborDay[] = [];
  for (const d of dateRange(OPS_START, OPS_END)) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    const busy = (listedPerDay.get(d) ?? 0) > 260;
    for (const e of emps) {
      if (!rng.chance(weekday === 6 ? 0.4 : 0.88)) continue;
      let hours = Math.max(3, Math.round(rng.normal(7.5, 0.7) * 4) / 4);
      if (busy && e.department === "E-Commerce Listing") hours += 1.5;
      const regular = Math.min(8, hours);
      laborDays.push({
        employee: e.id,
        department: e.department,
        jobTitle: e.jobTitle,
        date: d,
        regularHours: regular,
        overtimeHours: Math.round((hours - regular) * 100) / 100,
      });
    }
  }

  // Marketplace ratings, monthly per channel. Amazon reports no NPS; Mercari only a rating.
  const ratings: OpsRating[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (const period of ratingPeriods) {
    const py = period < OPS_START;
    const lift = py ? -0.08 : 0;
    const row = (marketplace: string, base: { rating: number | null; csat: number | null; nps: number | null; conv: number | null; sessions: number | null }) => {
      const csatN = base.csat === null ? null : rng.int(120, 480);
      const npsN = base.nps === null ? null : rng.int(60, 240);
      ratings.push({
        period,
        marketplace,
        sellerRating: base.rating === null ? null : r1(Math.min(100, base.rating + rng.normal(0, 0.3))),
        csat: base.csat === null ? null : r2(Math.min(5, base.csat + lift + rng.normal(0, 0.05))),
        csatResponses: csatN,
        nps: base.nps === null ? null : Math.round(base.nps + (py ? -6 : 0) + rng.normal(0, 3)),
        npsResponses: npsN,
        conversionPct: base.conv === null ? null : r2(base.conv * (py ? 0.92 : 1) + rng.normal(0, 0.15)),
        sessions: base.sessions === null ? null : Math.round(base.sessions * (py ? 0.9 : 1) * (0.95 + rng.float() * 0.1)),
      });
    };
    row("ShopGoodwill", { rating: 98.6, csat: 4.6, nps: 42, conv: 3.1, sessions: 61_000 });
    row("eBay", { rating: 99.4, csat: 4.8, nps: 51, conv: 2.4, sessions: 33_000 });
    row("Amazon", { rating: 97.9, csat: 4.7, nps: null, conv: 9.8, sessions: 14_500 });
    row("GoodwillBooks", { rating: null, csat: 4.5, nps: 38, conv: 2.0, sessions: 18_000 });
  }

  // 1st Source acct 0101: deposits from marketplaces, postage refills, carrier ACH, FedEx refunds.
  const bank: OpsBankLine[] = [];
  let ref = 40_000;
  const push = (date: string, description: string, amountCents: number, type: OpsBankLine["type"]) => {
    if (amountCents === 0) return;
    bank.push({ date, description, amountCents, type, reference: String(++ref) });
  };
  const bankPeriods = [...new Set(model.amazonEvents.map((e) => e.businessDate.slice(0, 7)))]
    .filter((p) => p !== OPS_END.slice(0, 7))
    .sort();
  const inBank = (d: string) => bankPeriods.includes(d.slice(0, 7));
  for (const e of model.amazonEvents) {
    if (e.type === "Transfer" && inBank(e.businessDate)) {
      push(addDays(e.businessDate, 2), "AMAZON.COM SERVICES PAYMENTS ACH CREDIT", -e.amountCents, "ACH CREDIT");
    }
  }
  // Postage refills: weekly (Mondays) per tool, rounded up to $100.
  const weekOf = (d: string) => {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    return addDays(d, wd === 0 ? 1 : 8 - wd); // next Monday
  };
  const sums = new Map<string, number>();
  const add = (k: string, c: number) => sums.set(k, (sums.get(k) ?? 0) + c);
  const ship = (s: Shipment) => {
    if (s.tool === "easypost") add(`EASYPOST POSTAGE REFILL|${weekOf(s.shipDate)}|POS DEBIT`, s.costCents);
    else if (s.tool === "pitney_bowes") add(`PITNEY BOWES POSTAGE BY PHONE|${weekOf(s.shipDate)}|ACH DEBIT`, s.costCents);
    else if (s.tool === "osm") add(`OSM WORLDWIDE INVOICE ACH|${addDays(`${s.shipDate.slice(0, 7)}-01`, 40).slice(0, 8)}10|ACH DEBIT`, s.costCents);
    else {
      add(`FEDEX ACH PAYMENT|${weekOf(s.shipDate)}|ACH DEBIT`, s.costCents + s.surchargeCents);
      if (s.refund === "refunded") add(`BNKDEPOSIT FEDEX REFUND|${addDays(weekOf(s.shipDate), 10)}|BNKDEPOSIT`, -s.costCents);
    }
  };
  for (const s of model.shipments) ship(s);
  for (const [k, cents] of sums) {
    const [desc, date, type] = k.split("|") as [string, string, OpsBankLine["type"]];
    if (!inBank(date)) continue;
    const rounded = desc.startsWith("EASYPOST") || desc.startsWith("PITNEY") ? Math.ceil(cents / 10_000) * 10_000 : cents;
    push(date, desc, -rounded, type);
  }
  for (const p of bankPeriods) push(`${p}-28`, "MONTHLY SERVICE CHARGE", -1_500, "SERVICE CHARGE");
  bank.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));

  const itemPeriods = ["2026-08", "2026-09", "2026-10"];
  return { items, employees: emps, laborDays, ratings, bank, itemPeriods, ratingPeriods: [...ratingPeriods], bankPeriods };
}
