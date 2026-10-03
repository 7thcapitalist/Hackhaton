// Synthetic demo data, ported from the Claude Design mockups so the screens match them
// number for number. No real customer data. Replace these functions with the view
// functions in src/lib/views (docs/interfaces.md §2) once they land; the shapes match.
import type { ChannelId, Kpi, PulseRow, PulseSeries, PulseView, Source, SourceIssue, SourceOrder } from "./types";
import { shiftDay } from "./format";

type ChannelMeta = {
  id: ChannelId; label: string; sublabel: string;
  base: number; aov: number; cpo: number; // daily revenue ($), order value ($), customers per order
  file: string; ext: "csv" | "xlsx"; importedAt: string;
};

export const CHANNELS: ChannelMeta[] = [
  { id: "shopgoodwill", label: "ShopGoodwill", sublabel: "shopgoodwill.com auctions", base: 6450, aov: 43.3, cpo: 0.9, file: "shopgoodwill_orders", ext: "csv", importedAt: "6:04 AM" },
  { id: "amazon", label: "Amazon", sublabel: "Seller Central settlement", base: 2180, aov: 25.4, cpo: 0.965, file: "amazon_settlement", ext: "xlsx", importedAt: "6:11 AM" },
  { id: "ebay", label: "eBay", sublabel: "Seller Hub transactions", base: 1860, aov: 30.8, cpo: 0.95, file: "ebay_transactions", ext: "csv", importedAt: "5:58 AM" },
  { id: "other", label: "Other e-comm", sublabel: "Cash Monkey · Upright · Goodwill Books", base: 540, aov: 38, cpo: 0.95, file: "other_ecomm", ext: "csv", importedAt: "6:20 AM" },
];

const N = 30;
const FIRST_DAY = "2026-09-03";
export const PULSE_DATES = Array.from({ length: N }, (_, i) => shiftDay(FIRST_DAY, i));
export const LATEST_DATE = PULSE_DATES[N - 1];
export const LAST_IMPORT_AT = "2026-10-03T10:12:00Z"; // 6:12 AM ET
export const SCORECARD_PERIOD = { id: "2026-09", label: "September 2026", short: "Sep", dataThrough: "Sep 30", generatedAt: "2026-10-03T10:15:00Z" };

const CATS = ["Jewelry", "Electronics", "Books", "Collectibles", "Clothing", "Toys", "Home Decor", "Art", "Tools", "Shoes"];
const WEEKDAY = [0.9, 1.06, 1.02, 0.99, 1.0, 0.97, 0.84];

function rng(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Day = { rev: number; orders: number; cust: number } | null;

const DATA: Record<string, Day[]> = (() => {
  const r = rng(11), out: Record<string, Day[]> = {};
  for (const c of CHANNELS) {
    out[c.id] = PULSE_DATES.map((d, i) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      const rev = Math.round(c.base * WEEKDAY[dow] * (1 + 0.005 * (i - 15)) * (0.88 + 0.24 * r()) * 100);
      const orders = Math.max(1, Math.round(rev / 100 / c.aov));
      return { rev, orders, cust: Math.round(orders * c.cpo) };
    });
  }
  out.shopgoodwill[29] = { rev: 684215, cust: 142, orders: 158 };
  out.shopgoodwill[22] = { rev: 640210, cust: 131, orders: 146 };
  out.amazon[29] = { rev: 231540, cust: 88, orders: 91 };
  out.amazon[22] = { rev: 214377, cust: 84, orders: 87 };
  out.ebay[29] = { rev: 197280, cust: 61, orders: 64 };
  out.ebay[22] = { rev: 185590, cust: 58, orders: 61 };
  out.other[29] = null; // Other e-comm file for Oct 2 hasn't arrived
  return out;
})();

export const sourceFileFor = (c: ChannelMeta, date: string) => `${c.file}_${date}.${c.ext}`;

export function isPulseDate(date: string | undefined): date is string {
  return !!date && PULSE_DATES.includes(date);
}

export function getPulse(date: string): PulseView {
  const i = PULSE_DATES.indexOf(date);
  const rows: PulseRow[] = CHANNELS.map(c => {
    const d = i >= 0 ? DATA[c.id][i] : null;
    return {
      channelId: c.id, label: c.label, sublabel: c.sublabel, sourceFile: sourceFileFor(c, date), importedAt: c.importedAt,
      status: d ? "ok" : "missing",
      revenueCents: d?.rev ?? null, customers: d?.cust ?? null, orders: d?.orders ?? null,
    };
  });
  const ok = rows.filter(r => r.status === "ok");
  return {
    businessDate: date,
    rows,
    totals: {
      revenueCents: ok.reduce((a, r) => a + r.revenueCents!, 0),
      customers: ok.reduce((a, r) => a + r.customers!, 0),
      orders: ok.reduce((a, r) => a + r.orders!, 0),
    },
    missingChannels: rows.filter(r => r.status === "missing").map(r => r.channelId),
    isSynthetic: true,
  };
}

/** Totals for `date` over only the given channels (week-over-week compares the same set). */
export function getPulseTotalsFor(date: string, channels: ChannelId[]) {
  const i = PULSE_DATES.indexOf(date);
  if (i < 0) return null;
  const days = channels.map(id => DATA[id][i]);
  if (days.some(d => d == null)) return null;
  return {
    revenueCents: days.reduce((a, d) => a + d!.rev, 0),
    customers: days.reduce((a, d) => a + d!.cust, 0),
    orders: days.reduce((a, d) => a + d!.orders, 0),
  };
}

export function getPulseSeries(): PulseSeries {
  return {
    dates: PULSE_DATES,
    series: CHANNELS.map(c => ({
      channelId: c.id, label: c.label,
      revenueCents: DATA[c.id].map(d => d?.rev ?? null),
      customers: DATA[c.id].map(d => d?.cust ?? null),
    })),
  };
}

/** Source rows behind one channel's pulse number. Net values sum exactly to the pulse revenue. */
export function getOrders(channelId: ChannelId, date: string): SourceOrder[] {
  const i = PULSE_DATES.indexOf(date);
  const c = CHANNELS.find(x => x.id === channelId);
  const d = c && i >= 0 ? DATA[c.id][i] : null;
  if (!c || !d) return [];
  const r = rng(i * 97 + c.id.charCodeAt(0) * 13);
  const w = Array.from({ length: d.orders }, () => 0.25 + r() * r() * 3);
  const sw = w.reduce((a, b) => a + b, 0);
  const nets = w.map(x => Math.round((x / sw) * d.rev));
  nets[nets.length - 1] += d.rev - nets.reduce((a, b) => a + b, 0);
  const mins = Array.from({ length: d.orders }, () => Math.floor(r() * 1440)).sort((a, b) => a - b);
  const sourceFile = sourceFileFor(c, date);
  return nets.map((net, k) => {
    const orderId =
      c.id === "shopgoodwill" ? `SG-${48213000 + k * 37 + Math.floor(r() * 30)}`
      : c.id === "amazon" ? `113-${String(Math.floor(r() * 1e7)).padStart(7, "0")}-${String(Math.floor(r() * 1e7)).padStart(7, "0")}`
      : c.id === "ebay" ? `12-${10000 + Math.floor(r() * 89999)}-${10000 + Math.floor(r() * 89999)}`
      : `OE-${70210 + k}`;
    const grossCents = Math.round(net / (0.84 + r() * 0.08));
    return { orderId, minute: mins[k], channelLabel: c.label, category: CATS[Math.floor(r() * r() * CATS.length)], grossCents, netCents: net, sourceFile, sourceRow: k + 2 };
  });
}

/** Most recent earlier day this channel delivered a file. */
export function lastReceivedBefore(channelId: ChannelId, date: string): string | null {
  for (let i = PULSE_DATES.indexOf(date) - 1; i >= 0; i--) if (DATA[channelId][i]) return PULSE_DATES[i];
  return null;
}

// ---- COO Scorecard ----

const TOP_REV: [string, number][] = [["Jewelry", 4820000], ["Electronics", 4170000], ["Books", 3390000], ["Collectibles", 2940000], ["Clothing", 2480000], ["Toys", 1860000], ["Home Decor", 1620000], ["Art", 1490000], ["Tools", 1230000], ["Shoes", 980000]];
const TOP_MARGIN: [string, number][] = [["Art", 41], ["Jewelry", 38], ["Collectibles", 35], ["Books", 33], ["Shoes", 29], ["Clothing", 27], ["Home Decor", 24], ["Toys", 22], ["Tools", 19], ["Electronics", 14]];

const KPI_BASE: Kpi[] = [
  { id: "net_margin", label: "Net Margin %", pillar: "financial", unit: "percent", value: 8.4, previous: 7.9, target: 9.0, status: "ok", anchor2027: true },
  { id: "revenue_total", label: "Total E-Commerce Revenue", pillar: "financial", unit: "cents", value: 31840000, previous: 30120000, target: 31000000, status: "ok", anchor2027: false },
  { id: "revenue_growth_yoy", label: "Revenue Growth % (YoY)", pillar: "financial", unit: "percent", value: 12.6, previous: 11.9, target: 10, status: "ok", anchor2027: false },
  { id: "listings_created", label: "Listings Created", pillar: "productivity", unit: "count", value: 9412, previous: 9050, target: 9000, status: "ok", anchor2027: false },
  { id: "revenue_per_labor_hour", label: "Revenue per Labor Hour", pillar: "productivity", unit: "cents_per_hour", value: 4620, previous: 4410, target: 4800, status: "ok", anchor2027: true },
  { id: "listings_per_employee", label: "Listings per Employee", pillar: "productivity", unit: "ratio", value: 588, previous: 566, target: 560, status: "ok", anchor2027: false, teamLevel: true },
  { id: "days_donation_to_listing", label: "Days from Donation to Listing", pillar: "inventory", unit: "days", value: 6.8, previous: 7.4, target: 7.0, status: "ok", anchor2027: false, lowerIsBetter: true },
  { id: "unlisted_backlog", label: "Unlisted Inventory Backlog", pillar: "inventory", unit: "count", value: null, previous: 4410, target: 4000, status: "awaiting_data", anchor2027: false, lowerIsBetter: true, note: "Warehouse count for September is due Oct 5." },
  { id: "unsold_inventory_pct", label: "Unsold Inventory %", pillar: "inventory", unit: "percent", value: 18.2, previous: 19.0, target: 20, status: "simulated", anchor2027: false, lowerIsBetter: true },
  { id: "avg_selling_price", label: "Average Selling Price", pillar: "sales", unit: "cents", value: 3384, previous: 3310, target: 3200, status: "ok", anchor2027: false },
  { id: "sell_through_rate", label: "Sell-Through Rate", pillar: "sales", unit: "percent", value: 71.3, previous: 69.8, target: 72, status: "ok", anchor2027: true },
  { id: "sales_per_employee", label: "Sales per Employee", pillar: "sales", unit: "cents", value: 1990000, previous: 1880000, target: 1940000, status: "ok", anchor2027: false, teamLevel: true },
  { id: "top10_revenue", label: "Top 10 Categories by Revenue", pillar: "category_customer", unit: "cents", value: 24980000, previous: 23510000, target: null, status: "ok", anchor2027: false, displaySuffix: "78% of total", breakdown: TOP_REV.map(([label, value]) => ({ label, value })) },
  { id: "top10_margin", label: "Top 10 Categories by Margin", pillar: "category_customer", unit: "percent", value: 31.4, previous: 30.6, target: null, status: "simulated", anchor2027: false, displaySuffix: "avg margin", breakdown: TOP_MARGIN.map(([label, value]) => ({ label, value })) },
  { id: "repeat_buyer_rate", label: "Repeat Buyer Rate", pillar: "category_customer", unit: "percent", value: 27.4, previous: 26.1, target: 30, status: "simulated", anchor2027: false },
];

/** 12 synthetic monthly points ending at prior month → this month (sparklines only). */
function history(k: Kpi, i: number): number[] {
  let s = (i + 3) * 7919;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const prev = k.previous ?? 0;
  const end = k.value ?? prev;
  const drift = (k.value != null ? k.value - prev : 0) || prev * 0.02;
  const pts = Array.from({ length: 12 }, (_, j) => prev - drift * (10 - j) * 0.55 + (r() - 0.5) * Math.abs(drift) * 1.6);
  pts[10] = prev;
  pts[11] = end;
  return pts;
}

export const PILLARS: { id: Kpi["pillar"]; name: string }[] = [
  { id: "financial", name: "Financial" },
  { id: "productivity", name: "Productivity" },
  { id: "inventory", name: "Inventory" },
  { id: "sales", name: "Sales" },
  { id: "category_customer", name: "Category + Cust." },
];

export function getScorecard() {
  return {
    period: SCORECARD_PERIOD,
    kpis: KPI_BASE.map((k, i) => ({ ...k, history: history(k, i) })),
    insights: [
      "Revenue rose 5.7% to $318.4k, led by Jewelry and Electronics, the two largest categories.",
      "Listings reached the site faster (6.8 days from donation, down from 7.4), lifting sell-through to 71.3%, just under the 72% target.",
      "Net margin is 8.4% vs. a 9.0% target. Shipping has 3 open data warnings, so treat margin as provisional.",
    ],
  };
}

// ---- Data Sources ----

const daily = (gaps: number[] = []) => Array.from({ length: 30 }, (_, i) => (gaps.includes(i) ? "warning" : "received") as "received" | "warning");

export const SOURCES: Source[] = [
  { id: "shopgoodwill", name: "ShopGoodwill", sublabel: "Marketplace · daily", cadence: "daily", status: "received", openIssues: 0, lastImportAt: "2026-10-01T10:04:00Z", rowCount: 4612, days: daily() },
  { id: "amazon", name: "Amazon", sublabel: "Marketplace · daily", cadence: "daily", status: "received", openIssues: 0, lastImportAt: "2026-10-01T10:11:00Z", rowCount: 2684, days: daily() },
  { id: "ebay", name: "eBay", sublabel: "Marketplace · daily", cadence: "daily", status: "received", openIssues: 0, lastImportAt: "2026-10-01T09:58:00Z", rowCount: 1907, days: daily() },
  { id: "cashmonkey", name: "Cash Monkey", sublabel: "Marketplace · monthly", cadence: "monthly", status: "received", openIssues: 0, lastImportAt: "2026-10-01T11:40:00Z", rowCount: 312 },
  { id: "upright", name: "Upright", sublabel: "Marketplace · monthly", cadence: "monthly", status: "missing", openIssues: 0, lastImportAt: null, lastFileLabel: "Sep 2 (August file)", rowCount: null },
  { id: "jewelry", name: "Jewelry", sublabel: "Specialty sales · monthly", cadence: "monthly", status: "missing", openIssues: 0, lastImportAt: null, lastFileLabel: "Sep 3 (August file)", rowCount: null },
  { id: "shipping_osm_pb_easypost", name: "Shipping", sublabel: "OSM · Pitney Bowes · EasyPost", cadence: "daily", status: "warnings", openIssues: 3, lastImportAt: "2026-10-01T10:16:00Z", rowCount: 9140, days: daily([12, 13]), impact: "Net margin may move once resolved." },
  { id: "fedex", name: "FedEx", sublabel: "Carrier invoices · daily", cadence: "daily", status: "received", openIssues: 0, lastImportAt: "2026-10-01T10:22:00Z", rowCount: 1233, days: daily() },
  { id: "goodwill_books", name: "Goodwill Books", sublabel: "Marketplace · monthly", cadence: "monthly", status: "warnings", openIssues: 1, lastImportAt: "2026-10-01T12:05:00Z", rowCount: 2045, impact: "Category totals may shift slightly." },
];

export const SOURCE_ISSUES: SourceIssue[] = [
  { text: "EasyPost file missing for Sep 13 and Sep 14", source: "Shipping", file: "easypost_labels_2026-09-1*.csv" },
  { text: "41 shipping labels have no matching order", source: "Shipping", file: "osm_shipments_2026-09.xlsx" },
  { text: "6 duplicate rows found and set aside", source: "Shipping", file: "pitneybowes_2026-09.csv" },
  { text: '118 rows have no category; counted under "Uncategorized"', source: "Goodwill Books", file: "gw_books_2026-09.xlsx" },
];

export const SOURCES_DUE = "Oct 5";

export function getSourceSummary() {
  const received = SOURCES.filter(s => s.status === "received");
  const warnings = SOURCES.filter(s => s.status === "warnings");
  const missing = SOURCES.filter(s => s.status === "missing");
  return {
    total: SOURCES.length,
    arrived: received.length + warnings.length,
    received, warnings, missing,
    openIssues: SOURCES.reduce((a, s) => a + s.openIssues, 0),
  };
}
