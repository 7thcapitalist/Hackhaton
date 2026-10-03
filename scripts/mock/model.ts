/**
 * The deterministic "truth" behind every mock file: what Goodwill Michiana's
 * e-commerce actually sold, refunded, paid and shipped between 2026-08-01 and
 * 2026-10-03. The writers (./writers/*) render this truth into each platform's
 * real export layout; the parsers read those files back. Pure, no I/O, no
 * Math.random: same seed => same model => byte-identical files.
 *
 * What is in it
 * - Marketplace order lines: ShopGoodwill (~55/day), Amazon (~45/day), eBay
 *   (~22/day), Goodwill Books (~12/day), and "other" sales through Upright
 *   (Facebook Marketplace, Mercari; ~8/day). Buyers repeat: ~30% of a month's
 *   buyers (per channel) have 2+ orders, and some people buy on two channels
 *   under different per-marketplace handles. Customer count on the pulse is
 *   still one per transaction (views decide that).
 * - Prior year 2025-08-01..2025-10-31 (~10% lower volume) for year-over-year
 *   growth, delivered as monthly files only.
 * - Upright is the source of truth for orders. Its Paid Order Items report
 *   lists every Goodwill Books and "other" sale, plus the ShopGoodwill and eBay
 *   orders that were listed through Upright (~2% / ~8%), with the SAME
 *   marketplace order and item ids, so its file overlaps the marketplace files.
 *   Amazon is not listed through Upright.
 * - Refunds (~3%) and cancellations (~1%, never on Amazon: a cancelled Amazon
 *   order is never charged, so it is not in the transaction report).
 * - Amazon money events: settlement transfers every 14 days, subscription and
 *   advertising fees, adjustments, one unknown "Liquidations" row.
 * - Cash Monkey bulk orders (weekdays), jewelry sales (monthly report),
 *   Goodwill Books statement adjustments.
 * - One shipment (label) per shipped order, bought through EasyPost, Pitney
 *   Bowes, OSM or FedEx, with label voids/credits and FedEx surcharges.
 *
 * Deliberate cases (kept in sync with the writers):
 * - 2026-10-02: no Amazon file (the writer skips it; the truth still has sales).
 * - 2026-10-03 is today: data through 11:30 AM local only.
 * - Late-night orders at 11:45 PM local (Eastern) on 2026-09-30 (ShopGoodwill)
 *   and 2026-10-01 (eBay, Amazon).
 * - An Amazon order from 2026-09-25 refunded on LATE_REFUND_DATE (refund row lands
 *   in a later file than its order).
 */
import { addDays, dateRange, daysBetween, localToUtc } from "../../src/lib/views/dates";
import { Rng } from "../seed/prng";
import { ebayLineFeeCents } from "../../src/connectors/mock/ebay";
import { buildOps, type OpsModel } from "./ops";

export const MOCK_SEED = 20261003;
export const START_DATE = "2026-08-01";
export const END_DATE = "2026-10-03";
/** Months whose month-end files exist (October is not closed yet). */
export const CLOSED_PERIODS = ["2026-08", "2026-09"] as const;
/**
 * Optional deliberate gap: no Amazon file for this business date. null = no gap, every
 * day has its Amazon file (Gabriel, 2026-10-03: the demo shows Oct 2 complete). Set a
 * date, e.g. "2026-10-02", to bring the "Awaiting data" case back.
 */
export const MISSING_AMAZON_DATE: string | null = null;
/** An Amazon refund whose order is in an earlier daily file. */
export const LATE_REFUND_DATE = "2026-09-29";
/**
 * Prior year, for year-over-year growth: 2025-08-01..2025-10-31, delivered as
 * monthly files only (no nightly files back then), ~10% lower volume.
 */
export const PY_START = "2025-08-01";
export const PY_END = "2025-10-31";
export const PY_PERIODS = ["2025-08", "2025-09", "2025-10"] as const;
export const PY_VOLUME = 0.9;
/** Every month that has month-end files: the prior year plus the closed months. */
export const MONTHLY_FILE_PERIODS: readonly string[] = [...PY_PERIODS, ...CLOSED_PERIODS];
/** "Now": no upload is later than this. */
export const SEED_NOW = "2026-10-03T16:00:00.000Z";
/** On END_DATE (today) only orders before 11:30 AM local exist yet. */
export const TODAY_CUTOFF_SECONDS = 11.5 * 3600;

export type Channel = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other";
export type Stream = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "upright_other";
export type OrderStatus = "paid" | "refunded" | "cancelled";
export type ShipTool = "easypost" | "pitney_bowes" | "osm" | "fedex";

export interface Shipment {
  tool: ShipTool;
  carrier: string;
  service: string;
  tracking: string;
  /** EasyPost shipment id (shp_…). */
  shipmentId: string;
  /** Business date the label was bought (period decides the monthly file). */
  shipDate: string;
  ts: Date;
  costCents: number;
  /** Label voided and refunded / refund requested but not granted yet. */
  refund: "refunded" | "submitted" | null;
  /** FedEx only: an extra surcharge billed on the next invoice. */
  surchargeCents: number;
  weightLb: number;
  /** What it shipped (for references). */
  ref: string;
}

export interface MockOrder {
  seq: number;
  stream: Stream;
  channel: Channel;
  /** "Channel" value in the Upright report. */
  uprightChannel: string;
  orderId: string;
  itemId: string;
  sku: string;
  title: string;
  category: string;
  ts: Date;
  businessDate: string;
  quantity: number;
  unitCents: number;
  grossCents: number;
  shippingCents: number;
  /** Amazon: product sales tax / shipping credits tax. Others: total tax. */
  productTaxCents: number;
  shippingTaxCents: number;
  taxCents: number;
  /** Fee before any refund (Amazon refund rows give part of it back). */
  origFeeCents: number;
  feeCents: number;
  refundCents: number;
  status: OrderStatus;
  /** When the refund happened (Amazon writes a separate Refund row). */
  refundTs: Date | null;
  /** Amazon: refund row lands in a later daily file than the order. */
  lateRefund: boolean;
  /** Raw marketplace buyer id (fake; each transaction is a new buyer). */
  buyerId: string | null;
  /** Also listed in the Upright Paid Order Items report. */
  inUpright: boolean;
  uprightOrderId: string;
  uprightProductId: string;
  lister: string;
  salesRecord: number;
  shipment: Shipment | null;
}

export interface CashMonkeyOrder {
  orderId: string;
  date: string;
  ts: Date;
  /** Write a time next to the date (late-night row). */
  withTime: boolean;
  itemCount: number;
  grossCents: number;
  feeCents: number;
  status: "Completed" | "Paid" | "Shipped" | "Cancelled" | "Refunded" | "Credit";
  shipment: Shipment | null;
}

export interface JewelrySale {
  date: string;
  orderId: string;
  itemId: string;
  description: string;
  category: string;
  priceCents: number;
  shippingCents: number;
  feeCents: number;
  supplier: string;
  shipment: Shipment | null;
}

export interface AmazonEvent {
  ts: Date;
  businessDate: string;
  type: "Transfer" | "Service Fee" | "Adjustment" | "Liquidations";
  description: string;
  /** "other" column for fees/adjustments; total for transfers. Signed as in the report. */
  amountCents: number;
}

export interface MockModel {
  orders: MockOrder[];
  cashMonkey: CashMonkeyOrder[];
  jewelry: JewelrySale[];
  amazonEvents: AmazonEvent[];
  /** Goodwill Books statement adjustment per period (negative = deduction). */
  gbAdjustments: Record<string, number>;
  /** Every label bought (orders, Cash Monkey lots, jewelry). */
  shipments: Shipment[];
  /** Item lifecycle, labor, ratings, bank statement (./ops.ts; own random stream). */
  ops: OpsModel;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const PRICE_MULT: Record<string, number> = {
  Books: 0.55, Media: 0.6, Clothing: 0.9, Shoes: 1.1, Handbags: 1.4, Jewelry: 1.6,
  Watches: 1.9, Electronics: 1.5, Collectibles: 1.2, Art: 1.5, "Home Decor": 0.9,
  Kitchen: 0.8, Toys: 0.8, "Sporting Goods": 1.1, Furniture: 1.3,
};

const NOUNS: Record<string, string[]> = {
  Books: ["Field Guide", "Cookbook", "Hardcover Novel", "Paperback Lot", "Textbook", "Atlas", "Poetry Collection", "Biography"],
  Media: ["Vinyl Record", "DVD Box Set", "CD Lot", "Audiobook", "Blu-ray Set"],
  Clothing: ["Wool Coat", "Denim Jacket", "Silk Blouse", "Flannel Shirt", "Cashmere Sweater", "Rain Jacket"],
  Shoes: ["Leather Boots", "Running Shoes", "Loafers", "Hiking Boots", "Sandals"],
  Handbags: ["Leather Satchel", "Crossbody Bag", "Tote Bag", "Clutch"],
  Jewelry: ["Sterling Ring", "Gold Tone Necklace", "Pearl Earrings", "Charm Bracelet", "Brooch"],
  Watches: ["Pocket Watch", "Wrist Watch", "Chronograph Watch"],
  Electronics: ["Film Camera", "Turntable", "Portable Radio", "Camera Lens", "Headphones", "Game Console"],
  Collectibles: ["Figurine", "Coin Lot", "Snow Globe", "Pewter Mug", "Trading Card Lot"],
  Art: ["Framed Print", "Oil Painting", "Watercolor", "Art Print"],
  "Home Decor": ["Brass Candlesticks", "Ceramic Vase", "Table Lamp", "Picture Frame Set", "Mantel Clock"],
  Kitchen: ["Pyrex Bowl", "Cast Iron Skillet", "Stoneware Mugs", "Fondue Set", "Glass Pitcher"],
  Toys: ["Board Game", "Puzzle 1000pc", "Lego Lot", "Plush Bear", "Model Train"],
  "Sporting Goods": ["Golf Balls", "Fishing Reel", "Tennis Racket", "Yoga Mat"],
  Furniture: ["Patio Chair", "Side Table", "Bookshelf", "Desk Chair"],
};
const ADJ = ["Vintage", "Retro", "Classic", "Antique", "Mid-Century", "Handmade", "Used", "Like New", "Pre-owned", "Lot of 2"];

const SKU_PREFIX: Record<string, string> = {
  Books: "BK", Media: "MD", Clothing: "CL", Shoes: "SH", Handbags: "HB", Jewelry: "JW", Watches: "WT",
  Electronics: "EL", Collectibles: "CO", Art: "AR", "Home Decor": "HM", Kitchen: "KT", Toys: "TY",
  "Sporting Goods": "SG", Furniture: "FN",
};

interface StreamDef {
  stream: Stream;
  channel: Channel;
  perDay: number;
  medianCents: number;
  categories: [string, number][];
  /** Upright "Channel" value(s) with weights. */
  uprightChannels: [string, number][];
  shipping: (rng: Rng, category: string, uprightChannel: string) => number;
  fee: (gross: number, shipping: number, category: string, uprightChannel: string) => number;
  taxRate: number;
}

const STREAMS: StreamDef[] = [
  {
    stream: "shopgoodwill",
    channel: "shopgoodwill",
    perDay: 55,
    medianCents: 2_400,
    categories: [
      ["Jewelry", 15], ["Collectibles", 15], ["Electronics", 12], ["Clothing", 10], ["Home Decor", 10],
      ["Art", 8], ["Watches", 8], ["Handbags", 7], ["Toys", 5], ["Sporting Goods", 5], ["Kitchen", 5],
    ],
    uprightChannels: [["ShopGoodwill", 1]],
    shipping: (rng) => 200 + Math.round(rng.logNormal(850, 0.35)), // shipping + $2 handling
    // ShopGoodwill keeps ~10% of the hammer price + ~3% card processing on what the buyer paid.
    fee: (gross, shipping) => Math.round(gross * 0.1) + Math.round((gross + shipping) * 0.03),
    taxRate: 0,
  },
  {
    stream: "amazon",
    channel: "amazon",
    perDay: 45,
    medianCents: 2_200,
    categories: [["Books", 60], ["Media", 25], ["Toys", 5], ["Electronics", 5], ["Collectibles", 5]],
    uprightChannels: [["Amazon", 1]],
    shipping: (_rng, cat) => (cat === "Books" || cat === "Media" ? 399 : 599),
    fee: (gross, _s, cat) => Math.round(gross * 0.15) + (cat === "Books" || cat === "Media" ? 180 : 0),
    taxRate: 0.07,
  },
  {
    stream: "ebay",
    channel: "ebay",
    perDay: 22,
    medianCents: 2_900,
    categories: [
      ["Clothing", 25], ["Shoes", 15], ["Electronics", 15], ["Collectibles", 15],
      ["Handbags", 10], ["Kitchen", 10], ["Sporting Goods", 10],
    ],
    uprightChannels: [["eBay", 1]],
    shipping: (rng) => (rng.chance(0.4) ? 0 : Math.round(rng.logNormal(800, 0.3))),
    // Final value fee 13.6% of the item price + $0.40 per order (same formula as the eBay API mock).
    fee: (gross) => ebayLineFeeCents(gross, true),
    taxRate: 0.07,
  },
  {
    stream: "upright_other",
    channel: "other",
    perDay: 8,
    medianCents: 2_300,
    categories: [["Clothing", 30], ["Shoes", 15], ["Handbags", 15], ["Home Decor", 15], ["Kitchen", 10], ["Furniture", 15]],
    uprightChannels: [["Facebook Marketplace", 70], ["Mercari", 30]],
    shipping: (_rng, _cat, ch) => (ch === "Mercari" ? 699 : 0), // Facebook: local pickup
    fee: (gross, _s, _c, ch) => (ch === "Mercari" ? Math.round(gross * 0.1) : 0),
    taxRate: 0,
  },
  {
    stream: "goodwill_books",
    channel: "goodwill_books",
    perDay: 12,
    medianCents: 1_900,
    categories: [["Books", 90], ["Media", 10]],
    uprightChannels: [["GoodwillBooks", 1]],
    shipping: () => 0, // free shipping to the buyer; Goodwill buys the label
    fee: (gross) => Math.round(gross * 0.15),
    taxRate: 0,
  },
];

/** Buyer pools per stream (see pickBuyer). Overlapping ranges = cross-channel people. */
const BUYER_POOLS: Record<Stream, { offset: number; size: number; skew: number }> = {
  shopgoodwill: { offset: 0, size: 3_000, skew: 2 },
  ebay: { offset: 2_500, size: 1_200, skew: 2 },
  goodwill_books: { offset: 3_400, size: 650, skew: 2 },
  upright_other: { offset: 3_900, size: 160, skew: 2 },
  amazon: { offset: 0, size: 1, skew: 1 },
};

const LISTERS = ["lister_A", "lister_B", "lister_C", "lister_D", "lister_E", "lister_F"];
const SUPPLIERS = ["Store 04", "Store 07", "Store 12", "Outlet DC"];
const JEWELRY_KINDS: [string, string][] = [
  ["Rings", "Sterling silver ring"], ["Necklaces", "Gold-tone necklace lot"], ["Brooches", "Vintage brooch"],
  ["Chains", "10k gold chain 18in"], ["Watches", "Watch lot (5)"], ["Earrings", "Pearl earrings"],
  ["Bracelets", "Turquoise bracelet"], ["Pendants", "Cameo pendant"],
];

const digits = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.int(0, 9)).join("");
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const priceEnding99 = (cents: number) => Math.max(199, Math.round(cents / 100) * 100 - 1);
const wholeDollars = (cents: number) => Math.max(100, Math.round(cents / 100) * 100);

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function buildModel(): MockModel {
  const rng = new Rng(MOCK_SEED);
  const pyDates = dateRange(PY_START, PY_END);
  const cyDates = dateRange(START_DATE, END_DATE);
  const dates = [...pyDates, ...cyDates];
  const orders: MockOrder[] = [];
  const shipments: Shipment[] = [];
  let seq = 0;
  let uprightSeq = 0;
  let salesRecord = 7000;
  const counters = { ep: 0, pb: 0, osm: 0, fx: 0 };

  const endOfDay = (date: string) => localToUtc(date, 86_399);

  const makeShipment = (tool: ShipTool, orderDate: string, chargedCents: number, ref: string): Shipment => {
    const lag = rng.weighted([[0, 70], [1, 25], [2, 5]] as const);
    const shipDate = addDays(orderDate, lag);
    const ts = localToUtc(shipDate, rng.int(9 * 3600, 17 * 3600));
    const costCents = chargedCents > 0 ? Math.round(chargedCents * (0.82 + rng.float() * 0.16)) : rng.int(320, 650);
    let carrier = "USPS";
    let service = "GroundAdvantage";
    let tracking: string;
    let shipmentId = "";
    let refund: Shipment["refund"] = null;
    let surchargeCents = 0;
    if (tool === "easypost") {
      counters.ep++;
      shipmentId = `shp_${pad(counters.ep, 8)}`;
      service = rng.chance(0.25) ? "Priority" : "GroundAdvantage";
      tracking = `94001${pad(counters.ep, 17)}`;
      const r = rng.float();
      refund = r < 0.015 ? "refunded" : r < 0.018 ? "submitted" : null;
    } else if (tool === "pitney_bowes") {
      counters.pb++;
      service = rng.chance(0.3) ? "Priority Mail" : "Ground Advantage";
      tracking = `94055${pad(counters.pb, 17)}`;
      refund = rng.chance(0.015) ? "refunded" : null;
    } else if (tool === "osm") {
      counters.osm++;
      carrier = "OSM Worldwide";
      service = rng.chance(0.6) ? "BPM" : "Parcel Select Lightweight";
      tracking = `OSM${pad(counters.osm, 11)}`;
      refund = rng.chance(0.01) ? "refunded" : null;
    } else {
      counters.fx++;
      carrier = "FedEx";
      service = rng.weighted([["FedEx Ground", 60], ["FedEx Home Delivery", 30], ["FedEx 2Day", 5], ["FedEx Express Saver", 5]] as const);
      tracking = `7700${pad(counters.fx, 8)}`;
      refund = rng.chance(0.015) ? "refunded" : null;
      surchargeCents = rng.chance(0.02) ? rng.int(1_200, 1_900) : 0;
    }
    const s: Shipment = {
      tool, carrier, service, tracking, shipmentId, shipDate, ts, costCents, refund, surchargeCents,
      weightLb: Math.round(rng.logNormal(1.6, 0.6) * 10) / 10,
      ref,
    };
    shipments.push(s);
    return s;
  };

  const toolFor = (o: MockOrder): ShipTool | null => {
    switch (o.stream) {
      case "amazon":
        return o.category === "Books" || o.category === "Media"
          ? rng.chance(0.5) ? "osm" : "easypost"
          : "easypost";
      case "shopgoodwill":
        return rng.weighted([["easypost", 45], ["pitney_bowes", 25], ["fedex", 30]] as const);
      case "ebay":
        return rng.weighted([["pitney_bowes", 50], ["easypost", 30], ["fedex", 20]] as const);
      case "goodwill_books":
        return rng.chance(0.6) ? "osm" : "pitney_bowes";
      case "upright_other":
        return o.uprightChannel === "Mercari" ? "easypost" : null; // Facebook: local pickup
    }
  };

  /**
   * Buyers repeat. Each channel draws its buyer from a skewed pool of "people"
   * (low indexes buy often), so ~30% of a month's buyers have 2+ orders. The
   * pools share an index range, so the same person can buy on two channels;
   * the handle differs per channel (buyer ids are per marketplace). Handles
   * are fake. Amazon (no buyer id in its report) and Facebook Marketplace
   * (no username in Upright) carry none.
   */
  const pickBuyer = (stream: Stream): number => {
    const pool = BUYER_POOLS[stream];
    return pool.offset + Math.floor(pool.size * Math.pow(rng.float(), pool.skew));
  };

  // ---- Marketplace orders ----------------------------------------------------
  for (const date of dates) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekdayFactor = weekday === 0 ? 1.2 : weekday === 6 ? 1.1 : weekday === 1 ? 0.95 : 1;
    const isPy = date < START_DATE;
    const dayIndex = daysBetween(isPy ? PY_START : START_DATE, date);
    const growth = (1 + 0.0015 * dayIndex) * (isPy ? PY_VOLUME : 1);

    for (const s of STREAMS) {
      const n = rng.count(s.perDay * weekdayFactor * growth);
      for (let i = 0; i < n; i++) {
        const category = rng.weighted(s.categories);
        const uprightChannel = rng.weighted(s.uprightChannels);
        const base = rng.logNormal(s.medianCents * (PRICE_MULT[category] ?? 1), 0.55);
        const unitCents = s.stream === "shopgoodwill" ? wholeDollars(base) : priceEnding99(base);
        const quantity = s.stream === "ebay" && rng.chance(0.04) ? 2 : 1;
        const grossCents = unitCents * quantity;
        const shippingCents = s.shipping(rng, category, uprightChannel);
        const productTaxCents = Math.round(grossCents * s.taxRate);
        const shippingTaxCents = Math.round(shippingCents * s.taxRate);
        const origFeeCents = s.fee(grossCents, shippingCents, category, uprightChannel);
        const r = rng.float();
        let status: OrderStatus = r < 0.01 ? "cancelled" : r < 0.04 ? "refunded" : "paid";
        if (s.stream === "amazon" && status === "cancelled") status = "paid"; // never charged → not in the report
        if (s.stream === "upright_other" && status === "cancelled") status = "paid"; // Upright lists paid items only
        if (s.stream === "goodwill_books" && status === "cancelled") status = "paid";
        let feeCents = origFeeCents;
        let refundCents = 0;
        if (status === "cancelled") {
          refundCents = grossCents + shippingCents;
          feeCents = 0;
        } else if (status === "refunded") {
          refundCents = grossCents + shippingCents;
          feeCents = s.stream === "goodwill_books" ? 0 : Math.round(origFeeCents * 0.2); // marketplaces keep part of the fee
        }

        // Evening-heavy local time of day.
        const sec = Math.min(86_399, Math.floor(Math.pow(rng.float(), 0.75) * 86_400));
        if (date === END_DATE && sec > TODAY_CUTOFF_SECONDS) continue;
        const ts = localToUtc(date, sec);
        const refundTs =
          status === "refunded"
            ? new Date(Math.max(ts.getTime(), Math.min(ts.getTime() + rng.int(3_600, 4 * 3_600) * 1000, endOfDay(date).getTime())))
            : null;

        seq++;
        const noun = rng.pick(NOUNS[category] ?? ["Item"]);
        const title = `${rng.pick(ADJ)} ${noun}`;
        const sku = `${SKU_PREFIX[category] ?? "GN"}-${pad(seq, 6)}`;
        let orderId: string;
        let itemId: string;
        let buyerId: string | null;
        switch (s.stream) {
          case "shopgoodwill":
            orderId = `SGW-${pad(7_700_000 + seq, 7)}`;
            itemId = `21${pad(seq, 7)}`;
            buyerId = `sgw_bidder_${pad(pickBuyer("shopgoodwill"), 6)}`;
            break;
          case "amazon":
            orderId = `${rng.int(111, 114)}-${digits(rng, 2)}${pad(seq, 5)}-${digits(rng, 7)}`;
            itemId = sku;
            buyerId = null; // the transaction report has no buyer id
            break;
          case "ebay":
            orderId = `${pad(rng.int(1, 27), 2)}-${pad(seq % 100_000, 5)}-${digits(rng, 5)}`;
            itemId = `31${pad(seq, 10)}`;
            buyerId = `ebuyer_${pad(pickBuyer("ebay"), 6)}`;
            break;
          case "goodwill_books": {
            orderId = `GWB-${pad(880_000 + seq, 6)}`;
            itemId = `GB-978${digits(rng, 3)}${pad(seq, 7)}`;
            buyerId = `gwb_reader_${pad(pickBuyer("goodwill_books"), 6)}`;
            break;
          }
          case "upright_other":
            if (uprightChannel === "Mercari") {
              orderId = `m${pad(seq, 11)}`;
              itemId = orderId;
              buyerId = `mercari_${pad(pickBuyer("upright_other"), 6)}`;
            } else {
              orderId = `FB-${pad(seq, 7)}`;
              itemId = orderId;
              buyerId = null; // Facebook Marketplace: no username in the report
            }
            break;
        }
        const inUpright =
          s.stream === "goodwill_books" || s.stream === "upright_other"
            ? true
            : status !== "cancelled" &&
              ((s.stream === "ebay" && rng.chance(0.08)) || (s.stream === "shopgoodwill" && rng.chance(0.02)));
        const o: MockOrder = {
          seq,
          stream: s.stream,
          channel: s.channel,
          uprightChannel,
          orderId,
          itemId,
          sku,
          title,
          category,
          ts,
          businessDate: date,
          quantity,
          unitCents,
          grossCents,
          shippingCents,
          productTaxCents,
          shippingTaxCents,
          taxCents: productTaxCents + shippingTaxCents,
          origFeeCents,
          feeCents,
          refundCents,
          status,
          refundTs,
          lateRefund: false,
          buyerId,
          inUpright,
          uprightOrderId: inUpright ? `UP-${pad(900_000 + ++uprightSeq, 6)}` : "",
          uprightProductId: `UPP-${pad(800_000 + seq, 6)}`,
          lister: rng.pick(LISTERS),
          salesRecord: s.stream === "ebay" ? ++salesRecord : 0,
          shipment: null,
        };
        orders.push(o);
      }
    }
  }

  // ---- Deliberate cases on orders ------------------------------------------
  const lateNight = (stream: Stream, date: string, label: string) => {
    const o = orders.find((x) => x.stream === stream && x.businessDate === date && x.status === "paid");
    if (!o) throw new Error(`mock model: no ${stream} order on ${date}`);
    o.ts = localToUtc(date, 23 * 3600 + 45 * 60); // 11:45 PM Eastern, already tomorrow in UTC
    o.title = `Late Night ${label}: ${o.title}`;
  };
  lateNight("shopgoodwill", "2026-09-30", "Auction");
  lateNight("ebay", "2026-10-01", "Order");
  lateNight("amazon", "2026-10-01", "Order");

  // An Amazon order of 2026-09-25 refunded on LATE_REFUND_DATE: the Refund row is in a later file.
  {
    const o = orders.find((x) => x.stream === "amazon" && x.businessDate === "2026-09-25" && x.status === "paid")!;
    o.status = "refunded";
    o.refundCents = o.grossCents + o.shippingCents;
    o.feeCents = Math.round(o.origFeeCents * 0.2);
    o.refundTs = localToUtc(LATE_REFUND_DATE, 14 * 3600 + 5 * 60);
    o.lateRefund = true;
  }
  // Make sure the Upright/eBay overlap is visible on 2026-09-20.
  {
    const o = orders.find((x) => x.stream === "ebay" && x.businessDate === "2026-09-20" && x.status === "paid")!;
    if (!o.inUpright) {
      o.inUpright = true;
      o.uprightOrderId = `UP-${pad(900_000 + ++uprightSeq, 6)}`;
    }
  }

  // Shipments for shipped orders.
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const tool = toolFor(o);
    if (tool) o.shipment = makeShipment(tool, o.businessDate, o.shippingCents, o.orderId);
  }

  // ---- Cash Monkey bulk orders (weekdays) -----------------------------------
  const cashMonkey: CashMonkeyOrder[] = [];
  let cmSeq = 100_000;
  for (const date of dates) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6 || date === END_DATE || !rng.chance(0.8)) continue;
    const itemCount = rng.int(8, 120);
    const grossCents = itemCount * rng.int(150, 400);
    const r = rng.float();
    const status: CashMonkeyOrder["status"] =
      r < 0.03 ? "Cancelled" : r < 0.05 ? "Refunded" : r < 0.65 ? "Completed" : r < 0.85 ? "Paid" : "Shipped";
    const o: CashMonkeyOrder = {
      orderId: `CM-${++cmSeq}`,
      date,
      ts: localToUtc(date, 12 * 3600), // date-only cells are read as local noon
      withTime: false,
      itemCount,
      grossCents,
      feeCents: Math.round(grossCents * 0.15),
      status,
      shipment: null,
    };
    if (status !== "Cancelled") o.shipment = makeShipment("fedex", date, 0, o.orderId);
    if (o.shipment) o.shipment.costCents = rng.int(1_500, 4_500); // one heavy box per lot
    cashMonkey.push(o);
  }
  // Late-night lot on the last day of September, and one credit memo per closed month.
  {
    const late: CashMonkeyOrder = {
      orderId: `CM-${++cmSeq}`,
      date: "2026-09-30",
      ts: localToUtc("2026-09-30", 23 * 3600 + 45 * 60),
      withTime: true,
      itemCount: 22,
      grossCents: 6_600,
      feeCents: 990,
      status: "Completed",
      shipment: null,
    };
    cashMonkey.push(late);
    for (const period of CLOSED_PERIODS) {
      const src = cashMonkey.find((c) => c.date.startsWith(period) && c.status === "Completed" && c.itemCount >= 20)!;
      const back = rng.int(5, 12);
      const creditDate = addDays(src.date, 6);
      cashMonkey.push({
        orderId: `${src.orderId}-R`,
        date: creditDate,
        ts: localToUtc(creditDate, 12 * 3600),
        withTime: false,
        itemCount: -back,
        grossCents: -back * Math.round(src.grossCents / src.itemCount),
        feeCents: -Math.round(back * Math.round(src.grossCents / src.itemCount) * 0.15),
        status: "Credit",
        shipment: null,
      });
    }
    cashMonkey.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  // ---- Jewelry report sales ---------------------------------------------------
  const jewelry: JewelrySale[] = [];
  let jSeq = 5_000;
  for (const period of MONTHLY_FILE_PERIODS) {
    const days = dates.filter((d) => d.startsWith(period));
    const n = rng.int(15, 22) - (period < START_DATE ? 2 : 0);
    const picked = Array.from({ length: n }, () => rng.pick(days)).sort();
    for (const date of picked) {
      const [category, desc] = rng.pick(JEWELRY_KINDS);
      const priceCents = priceEnding99(rng.logNormal(5_500, 0.6));
      const sale: JewelrySale = {
        date,
        orderId: `J-${++jSeq}`,
        itemId: `JW-${pad(jSeq - 5_000, 4)}`,
        description: desc,
        category,
        priceCents,
        shippingCents: rng.pick([395, 495, 550]),
        feeCents: Math.round(priceCents * 0.1),
        supplier: rng.pick(SUPPLIERS),
        shipment: null,
      };
      sale.shipment = makeShipment("pitney_bowes", date, sale.shippingCents, sale.orderId);
      jewelry.push(sale);
    }
  }
  // September: one row where the Co-Pivot step did not fill Supplier, and one return.
  {
    const sep = jewelry.filter((j) => j.date.startsWith("2026-09"));
    sep[3]!.supplier = "";
    const src = sep[1]!;
    const returnDate = addDays(src.date, 7) <= "2026-09-30" ? addDays(src.date, 7) : "2026-09-30";
    jewelry.push({
      ...src,
      date: returnDate,
      orderId: `${src.orderId}R`,
      description: `${src.description} (return)`,
      priceCents: -src.priceCents,
      shippingCents: 0,
      feeCents: 0,
      shipment: null,
    });
    jewelry.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- Amazon money events -----------------------------------------------------
  const amazonEvents: AmazonEvent[] = [];
  const ev = (date: string, sec: number, type: AmazonEvent["type"], description: string, amountCents: number) => {
    if (date === MISSING_AMAZON_DATE || date > END_DATE) return;
    if (date === END_DATE && sec > TODAY_CUTOFF_SECONDS) return;
    amazonEvents.push({ ts: localToUtc(date, sec), businessDate: date, type, description, amountCents });
  };
  for (const date of dates) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (date.endsWith("-15")) ev(date, 18 * 3600 + 33 * 60, "Service Fee", "Subscription", -3_999);
    if (weekday === 1) ev(date, 15 * 3600 + 15 * 60, "Service Fee", "Cost of Advertising", -rng.int(500, 2_500));
  }
  ev("2026-08-20", 14 * 3600 + 15 * 60, "Adjustment", "SAFE-T reimbursement", 1_250);
  ev("2026-09-20", 14 * 3600 + 15 * 60, "Adjustment", "SAFE-T reimbursement", 500);
  ev("2026-09-24", 17 * 3600 + 45 * 60, "Liquidations", "Liquidation proceeds", 310);
  // Settlement transfers every 14 days: everything since the previous transfer.
  for (const [rangeStart, firstTransfer, rangeEnd] of [
    [PY_START, "2025-08-08", PY_END],
    [START_DATE, "2026-08-07", END_DATE],
  ] as const) {
    let windowStart: string = rangeStart;
    for (let d: string = firstTransfer; d <= rangeEnd; d = addDays(d, 14)) {
      let total = 0;
      for (const o of orders) {
        if (o.stream !== "amazon" || o.businessDate < windowStart || o.businessDate >= d) continue;
        total += o.grossCents + o.shippingCents - o.origFeeCents; // order row total (tax is withheld)
        if (o.status === "refunded" && !o.lateRefund) total -= o.refundCents - (o.origFeeCents - o.feeCents);
      }
      for (const e of amazonEvents) if (e.businessDate >= windowStart && e.businessDate < d) total += e.amountCents;
      ev(d, 9 * 3600 + 20 * 60, "Transfer", "To account ending in: 0101", -total);
      windowStart = d;
    }
  }
  amazonEvents.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // ---- Goodwill Books statement adjustments --------------------------------------
  const gbAdjustments: Record<string, number> = {};
  for (const period of MONTHLY_FILE_PERIODS) gbAdjustments[period] = -rng.int(150, 900);

  const base = { orders, cashMonkey, jewelry, amazonEvents, gbAdjustments, shipments };
  return { ...base, ops: buildOps(base, [...MONTHLY_FILE_PERIODS, "2026-10"]) };
}

/** Orders of one business date for a stream, by time. */
export function ordersOn(model: MockModel, stream: Stream, date: string): MockOrder[] {
  return model.orders
    .filter((o) => o.stream === stream && o.businessDate === date)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq);
}
