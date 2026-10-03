/**
 * Deterministic synthetic data generator for the seed (pure: no DB access).
 *
 * Covers business dates 2026-08-01 .. 2026-10-03 (so September has a prior
 * month on the scorecard). Everything here is fake: buyer IDs are generated
 * and hashed, employees are pseudonyms, order IDs are random-looking strings.
 *
 * Deliberate messy cases:
 * - No Amazon ingest run for 2026-10-02 (pulse shows Amazon "missing").
 * - eBay 2026-09-15 file parsed with a warning (renamed column), resolved.
 * - Upright 2026-09-20 reports an order eBay already reported: the Upright row
 *   is skipped (eBay is revenue authority) and a duplicate_order exception is open.
 * - Monthly sources (Cash Monkey, Jewelry, shipping, FedEx, Goodwill Books)
 *   only have files for 2026-08 and 2026-09; October is not closed yet.
 */
import { createHash } from "node:crypto";
import type {
  NewDataException,
  NewIngestRun,
  NewItem,
  NewLaborHour,
  NewMoneyLine,
  NewOrder,
} from "../../src/db/schema";
import {
  addDays,
  businessDateOf,
  dateRange,
  daysBetween,
  localToUtc,
} from "../../src/lib/views/dates";
import { Rng } from "./prng";

export const SEED = 20261003;
export const START_DATE = "2026-08-01";
export const END_DATE = "2026-10-03";
/** Months whose month-end files have been received. */
export const CLOSED_PERIODS = ["2026-08", "2026-09"];
/** The deliberate gap: no Amazon file for this business date. */
export const MISSING_AMAZON_DATE = "2026-10-02";
/** "Now" for the seed: no upload timestamp is later than this. */
export const SEED_NOW = "2026-10-03T16:00:00.000Z";
const minIso = (a: string, b: string) => (a < b ? a : b);

/**
 * Fixed salt for synthetic buyer keys so the seed is deterministic. Real
 * ingest uses BUYER_KEY_SALT from the environment; this salt only ever hashes
 * generated IDs like "amazon-buyer-42".
 */
const SYNTHETIC_BUYER_SALT = "mission-control-synthetic-seed-v1";

export function buyerKey(sourceId: string, rawBuyerId: string): string {
  return createHash("sha256").update(`${SYNTHETIC_BUYER_SALT}:${sourceId}:${rawBuyerId}`).digest("hex");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const CATEGORY_PRICE_MULT: Record<string, number> = {
  Books: 0.55,
  Media: 0.6,
  Clothing: 0.9,
  Shoes: 1.1,
  Handbags: 1.4,
  Jewelry: 1.6,
  Watches: 1.9,
  Electronics: 1.5,
  Collectibles: 1.2,
  Art: 1.5,
  "Home Decor": 0.9,
  Kitchen: 0.8,
  Toys: 0.8,
  "Sporting Goods": 1.1,
};

interface Stream {
  sourceId: string;
  channel: "shopgoodwill" | "amazon" | "ebay" | "other" | "goodwill_books";
  cadence: "daily" | "monthly";
  ordersPerDay: number;
  medianPriceCents: number;
  buyerPool: number;
  categories: [string, number][];
  shipping: (rng: Rng, category: string) => number;
  fee: (gross: number, shipping: number, category: string) => number;
  taxRate: number;
  externalId: (rng: Rng) => string;
}

const digits = (rng: Rng, n: number) =>
  Array.from({ length: n }, () => rng.int(0, 9)).join("");

const STREAMS: Stream[] = [
  {
    sourceId: "shopgoodwill",
    channel: "shopgoodwill",
    cadence: "daily",
    ordersPerDay: 55,
    medianPriceCents: 2_400,
    buyerPool: 2_200,
    categories: [
      ["Jewelry", 15], ["Collectibles", 15], ["Electronics", 12], ["Clothing", 10],
      ["Home Decor", 10], ["Art", 8], ["Watches", 8], ["Handbags", 7], ["Toys", 5],
      ["Sporting Goods", 5], ["Kitchen", 5],
    ],
    shipping: (rng) => Math.round(rng.logNormal(950, 0.35)),
    fee: (gross) => Math.round(gross * 0.08),
    taxRate: 0.07,
    externalId: (rng) => `${rng.int(200, 299)}${digits(rng, 6)}`,
  },
  {
    sourceId: "amazon",
    channel: "amazon",
    cadence: "daily",
    ordersPerDay: 45,
    medianPriceCents: 2_200,
    buyerPool: 3_500,
    categories: [["Books", 60], ["Media", 25], ["Toys", 5], ["Electronics", 5], ["Collectibles", 5]],
    shipping: (_rng, cat) => (cat === "Books" || cat === "Media" ? 399 : 599),
    fee: (gross, _s, cat) => Math.round(gross * 0.15) + (cat === "Books" || cat === "Media" ? 180 : 0),
    taxRate: 0.07,
    externalId: (rng) => `${rng.int(111, 114)}-${digits(rng, 7)}-${digits(rng, 7)}`,
  },
  {
    sourceId: "ebay",
    channel: "ebay",
    cadence: "daily",
    ordersPerDay: 22,
    medianPriceCents: 2_900,
    buyerPool: 1_300,
    categories: [
      ["Clothing", 25], ["Shoes", 15], ["Electronics", 15], ["Collectibles", 15],
      ["Handbags", 10], ["Kitchen", 10], ["Sporting Goods", 10],
    ],
    shipping: (rng) => (rng.chance(0.4) ? 0 : Math.round(rng.logNormal(800, 0.3))),
    fee: (gross, shipping) => Math.round((gross + shipping) * 0.1325) + 30,
    taxRate: 0.07,
    externalId: (rng) => `${digits(rng, 2)}-${digits(rng, 5)}-${digits(rng, 5)}`,
  },
  {
    sourceId: "upright",
    channel: "other",
    cadence: "daily",
    ordersPerDay: 8,
    medianPriceCents: 2_300,
    buyerPool: 400,
    categories: [["Clothing", 40], ["Shoes", 20], ["Handbags", 15], ["Home Decor", 15], ["Kitchen", 10]],
    shipping: () => 699,
    fee: (gross) => Math.round(gross * 0.12),
    taxRate: 0,
    externalId: (rng) => `UP-${digits(rng, 7)}`,
  },
  {
    sourceId: "goodwill_books",
    channel: "goodwill_books",
    cadence: "monthly",
    ordersPerDay: 12,
    medianPriceCents: 1_900,
    buyerPool: 900,
    categories: [["Books", 90], ["Media", 10]],
    shipping: () => 399,
    fee: (gross) => Math.round(gross * 0.15),
    taxRate: 0,
    externalId: (rng) => `GB${digits(rng, 8)}`,
  },
  {
    sourceId: "cashmonkey",
    channel: "other",
    cadence: "monthly",
    ordersPerDay: 3,
    medianPriceCents: 2_000,
    buyerPool: 220,
    categories: [["Media", 50], ["Electronics", 30], ["Books", 20]],
    shipping: () => 499,
    fee: (gross) => Math.round(gross * 0.1),
    taxRate: 0,
    externalId: (rng) => `CM-${digits(rng, 7)}`,
  },
];

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

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface SeedData {
  ingestRuns: NewIngestRun[];
  orders: NewOrder[];
  moneyLines: NewMoneyLine[];
  items: NewItem[];
  laborHours: NewLaborHour[];
  exceptions: NewDataException[];
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
const priceEnding99 = (cents: number) => Math.max(199, Math.round(cents / 100) * 100 - 1);
const nextPeriodDay = (period: string, day: number) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
};

export function generate(): SeedData {
  const rng = new Rng(SEED);
  const dates = dateRange(START_DATE, END_DATE);
  const runs = new Map<string, NewIngestRun>();
  const rowCounters = new Map<string, number>();
  const orders: NewOrder[] = [];
  const moneyLines: NewMoneyLine[] = [];
  const items: NewItem[] = [];
  const laborHours: NewLaborHour[] = [];
  const exceptions: NewDataException[] = [];
  const usedDedupe = new Set<string>();
  let orderSeq = 0;
  let itemSeq = 0;
  let lineSeq = 0;

  const nextRow = (runId: string) => {
    const n = (rowCounters.get(runId) ?? 1) + 1; // row 1 is the header
    rowCounters.set(runId, n);
    return n;
  };

  const dailyRun = (sourceId: string, date: string): NewIngestRun => {
    const id = `run-${sourceId}-${date}`;
    let run = runs.get(id);
    if (!run) {
      run = {
        id,
        sourceId,
        period: null,
        businessDate: date,
        fileName: `synthetic-${sourceId}-${date}.csv`,
        fileSha256: sha256(`synthetic:${id}`),
        rowCount: 0,
        headerRowIndex: 0,
        parserVersion: "seed-1",
        status: "parsed",
        isSynthetic: 1,
        // ~6:30 AM Eastern next day, never later than the seed "now".
        uploadedAt: minIso(`${addDays(date, 1)}T10:30:00.000Z`, SEED_NOW),
      };
      runs.set(id, run);
    }
    return run;
  };

  const monthlyRun = (sourceId: string, period: string): NewIngestRun => {
    const id = `run-${sourceId}-${period}`;
    let run = runs.get(id);
    if (!run) {
      run = {
        id,
        sourceId,
        period,
        businessDate: null,
        periodLabel: sourceId === "shopgoodwill" ? "Period 3" : null,
        fileName: `synthetic-${sourceId}-${period}.xlsx`,
        fileSha256: sha256(`synthetic:${id}`),
        rowCount: 0,
        headerRowIndex: 0,
        parserVersion: "seed-1",
        status: "parsed",
        isSynthetic: 1,
        uploadedAt: `${nextPeriodDay(period, 3)}T14:00:00.000Z`,
      };
      runs.set(id, run);
    }
    return run;
  };

  // ---- Orders + sold items ------------------------------------------------
  const shippingByDay = new Map<string, number>();
  const netByDayChannel = new Map<string, number>();

  for (const [dayIndex, date] of dates.entries()) {
    const period = date.slice(0, 7);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekdayFactor = weekday === 0 ? 1.2 : weekday === 6 ? 1.1 : weekday === 1 ? 0.95 : 1;
    const growth = 1 + 0.0015 * dayIndex;

    for (const s of STREAMS) {
      if (s.cadence === "monthly" && !CLOSED_PERIODS.includes(period)) continue;
      if (s.sourceId === "amazon" && date === MISSING_AMAZON_DATE) continue;
      const run = s.cadence === "daily" ? dailyRun(s.sourceId, date) : monthlyRun(s.sourceId, period);
      const n = rng.count(s.ordersPerDay * weekdayFactor * growth);

      for (let i = 0; i < n; i++) {
        const category = rng.weighted(s.categories);
        const gross = priceEnding99(rng.logNormal(s.medianPriceCents * (CATEGORY_PRICE_MULT[category] ?? 1), 0.55));
        const shipping = s.shipping(rng, category);
        const tax = Math.round(gross * s.taxRate);
        const r = rng.float();
        const status: NewOrder["status"] = r < 0.01 ? "cancelled" : r < 0.04 ? "refunded" : "paid";
        let fee = s.fee(gross, shipping, category);
        let refund = 0;
        if (status === "cancelled") {
          refund = gross + shipping;
          fee = 0;
        } else if (status === "refunded") {
          refund = gross + shipping;
          fee = Math.round(fee * 0.2); // marketplaces keep part of the fee
        }
        const net = gross + shipping - refund - fee;

        // Evening-heavy local time of day.
        const secondsOfDay = Math.min(86_399, Math.floor(Math.pow(rng.float(), 0.75) * 86_400));
        const orderTs = localToUtc(date, secondsOfDay);
        const businessDate = businessDateOf(orderTs);

        let externalOrderId = s.externalId(rng);
        orderSeq++;
        const externalItemId = `${s.channel.slice(0, 3).toUpperCase()}-ITM-${String(orderSeq).padStart(6, "0")}`;
        let dedupeKey = `${s.channel}:${externalOrderId}:${externalItemId}`;
        while (usedDedupe.has(dedupeKey)) {
          externalOrderId = s.externalId(rng);
          dedupeKey = `${s.channel}:${externalOrderId}:${externalItemId}`;
        }
        usedDedupe.add(dedupeKey);

        const buyerIdx = Math.floor(s.buyerPool * Math.pow(rng.float(), 2.2));

        // Sold item lifecycle (synthetic).
        itemSeq++;
        const itemId = `item-${String(itemSeq).padStart(6, "0")}`;
        const daysToSell = Math.min(120, Math.round(rng.logNormal(9, 0.8)));
        const listedAt = new Date(orderTs.getTime() - daysToSell * 86_400_000 - rng.int(0, 36_000) * 1000);
        const sentAt = new Date(listedAt.getTime() - rng.logNormal(4, 0.7) * 86_400_000);
        const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * 86_400_000);
        const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * 86_400_000);
        items.push({
          id: itemId,
          ingestRunId: null,
          category,
          donatedAt: iso(donatedAt),
          identifiedAt: iso(identifiedAt),
          sentToEcomAt: iso(sentAt),
          listedAt: iso(listedAt),
          soldAt: status === "cancelled" ? null : iso(orderTs),
          listedBy: rng.pick(LISTERS),
          channelSourceId: s.sourceId,
          listPriceCents: Math.round(gross * (1 + rng.float() * 0.2)),
          salePriceCents: status === "cancelled" ? null : gross,
          relistCount: daysToSell > 30 ? 1 : 0,
        });

        orders.push({
          id: `ord-${String(orderSeq).padStart(6, "0")}`,
          sourceId: s.sourceId,
          ingestRunId: run.id,
          sourceRow: nextRow(run.id),
          channel: s.channel,
          externalOrderId,
          externalItemId,
          dedupeKey,
          orderTs: iso(orderTs),
          businessDate,
          buyerKey: buyerKey(s.sourceId, `${s.channel}-buyer-${buyerIdx}`),
          itemId,
          category,
          quantity: 1,
          currency: "USD",
          grossCents: gross,
          refundCents: refund,
          feeCents: fee,
          shippingCents: shipping,
          taxCents: tax,
          netCents: net,
          status,
        });

        if (status !== "cancelled") {
          shippingByDay.set(businessDate, (shippingByDay.get(businessDate) ?? 0) + shipping);
        }
        const k = `${businessDate}|${s.channel}`;
        netByDayChannel.set(k, (netByDayChannel.get(k) ?? 0) + net);
      }
    }
  }

  // ---- Duplicate: Upright reports an eBay order on 2026-09-20 ---------------
  {
    const dupDate = "2026-09-20";
    const ebayOrder = orders.find((o) => o.channel === "ebay" && o.businessDate === dupDate)!;
    const uprightRun = dailyRun("upright", dupDate);
    const skippedRow = nextRow(uprightRun.id); // the row exists in the file, not in orders
    uprightRun.status = "parsed_with_warnings";
    uprightRun.warningsJson = JSON.stringify([
      { row: skippedRow, message: `Duplicate of eBay order ${ebayOrder.externalOrderId}; skipped (eBay is revenue authority)` },
    ]);
    exceptions.push({
      id: "exc-dup-upright-ebay-2026-09-20",
      sourceId: "upright",
      ingestRunId: uprightRun.id,
      kind: "duplicate_order",
      message: `Upright row ${skippedRow} reports eBay order ${ebayOrder.externalOrderId} (${ebayOrder.dedupeKey}) already loaded from eBay. Upright row skipped; confirm and resolve.`,
      expectedCents: ebayOrder.netCents ?? 0,
      actualCents: ebayOrder.netCents ?? 0,
      owner: "E-commerce manager",
      status: "open",
      createdAt: "2026-09-21T10:35:00.000Z",
    });
  }

  // ---- Parse warning on eBay 2026-09-15 (resolved) --------------------------
  {
    const run = dailyRun("ebay", "2026-09-15");
    run.status = "parsed_with_warnings";
    run.warningsJson = JSON.stringify([{ message: "Column 'Sold For' renamed to 'Sold for (USD)'; mapped automatically" }]);
    exceptions.push({
      id: "exc-parse-ebay-2026-09-15",
      sourceId: "ebay",
      ingestRunId: run.id,
      kind: "parse_warning",
      message: "eBay header changed: 'Sold For' is now 'Sold for (USD)'. Mapped automatically; parser updated.",
      owner: "E-commerce manager",
      status: "resolved",
      createdAt: "2026-09-16T10:30:00.000Z",
      resolvedAt: "2026-09-16T15:10:00.000Z",
    });
  }

  // ---- Missing Amazon file on 2026-10-02 -------------------------------------
  exceptions.push({
    id: "exc-missing-amazon-2026-10-02",
    sourceId: "amazon",
    ingestRunId: null,
    kind: "missing_source",
    message: `No Amazon file received for business date ${MISSING_AMAZON_DATE}. Pulse shows Amazon as missing.`,
    owner: "E-commerce manager",
    status: "open",
    createdAt: "2026-10-03T11:05:00.000Z",
  });

  // ---- Daily runs exist even on days with zero orders ----------------------
  for (const date of dates) {
    for (const s of STREAMS) {
      if (s.cadence !== "daily") continue;
      if (s.sourceId === "amazon" && date === MISSING_AMAZON_DATE) continue;
      dailyRun(s.sourceId, date);
    }
  }

  const addLine = (runId: string, line: Omit<NewMoneyLine, "id" | "ingestRunId" | "sourceRow">) => {
    lineSeq++;
    moneyLines.push({ id: `ml-${String(lineSeq).padStart(6, "0")}`, ingestRunId: runId, sourceRow: nextRow(runId), ...line });
  };

  // ---- Payouts on daily marketplace runs -------------------------------------
  const payout = (sourceId: string, channel: string, everyDays: number, firstDate: string, prefix: string) => {
    let windowStart = START_DATE;
    for (let d = firstDate; d <= END_DATE; d = addDays(d, everyDays)) {
      if (sourceId === "amazon" && d === MISSING_AMAZON_DATE) continue;
      let amount = 0;
      for (const wd of dateRange(windowStart, addDays(d, -1))) amount += netByDayChannel.get(`${wd}|${channel}`) ?? 0;
      windowStart = d;
      if (amount <= 0) continue;
      addLine(dailyRun(sourceId, d).id, {
        sourceId,
        channel,
        lineDate: d,
        period: d.slice(0, 7),
        amountType: "payout",
        amountCents: amount,
        payoutId: `${prefix}-${d.replaceAll("-", "")}`,
        settlementId: sourceId === "amazon" ? `${prefix}-SET-${d.replaceAll("-", "")}` : null,
        bankAccountNo: "0101",
        reference: `${prefix}-${d.replaceAll("-", "")}`,
        memo: `Synthetic ${sourceId} payout`,
      });
    }
  };
  payout("amazon", "amazon", 14, "2026-08-07", "AMZ");
  payout("ebay", "ebay", 7, "2026-08-04", "EBY");
  payout("shopgoodwill", "shopgoodwill", 7, "2026-08-06", "SGW");

  // ---- Monthly money lines: shipping, FedEx, Goodwill Books, Jewelry --------
  const carriers: [string, number][] = [["OSM", 0.5], ["Pitney Bowes", 0.2], ["EasyPost", 0.3]];
  for (const period of CLOSED_PERIODS) {
    const days = dates.filter((d) => d.startsWith(period));
    const shipRun = monthlyRun("shipping_osm_pb_easypost", period);
    const fedexRun = monthlyRun("fedex", period);
    let fedexWeek = 0;
    let fedexInvoice = 1;
    for (const d of days) {
      const labelCost = Math.round((shippingByDay.get(d) ?? 0) * (0.85 + rng.float() * 0.1));
      const uspsShare = Math.round(labelCost * 0.7);
      for (const [carrier, share] of carriers) {
        addLine(shipRun.id, {
          sourceId: "shipping_osm_pb_easypost",
          channel: null,
          lineDate: d,
          period,
          amountType: "shipping_label",
          amountCents: -Math.round(uspsShare * share),
          bankAccountNo: "0101",
          reference: `${carrier.replace(/\s/g, "").toUpperCase()}-${d.replaceAll("-", "")}`,
          memo: `${carrier} postage`,
        });
      }
      fedexWeek += labelCost - uspsShare;
      const isWeekEnd = new Date(`${d}T12:00:00Z`).getUTCDay() === 6 || d === days[days.length - 1];
      if (isWeekEnd && fedexWeek > 0) {
        const inv = `FDX-${period.replace("-", "")}-${String(fedexInvoice++).padStart(2, "0")}`;
        addLine(fedexRun.id, {
          sourceId: "fedex",
          channel: null,
          lineDate: d,
          period,
          amountType: "shipping_label",
          amountCents: -fedexWeek,
          reference: inv,
          memo: "FedEx weekly invoice",
        });
        if (rng.chance(0.4)) {
          addLine(fedexRun.id, {
            sourceId: "fedex",
            channel: null,
            lineDate: d,
            period,
            amountType: "shipping_refund",
            amountCents: Math.round(fedexWeek * (0.01 + rng.float() * 0.02)),
            reference: `${inv}-ADJ`,
            memo: "FedEx refund (BNKDEPOSIT)",
          });
        }
        fedexWeek = 0;
      }
    }

    // Goodwill Books statement: one payment line for the month.
    const gbNet = days.reduce((s, d) => s + (netByDayChannel.get(`${d}|goodwill_books`) ?? 0), 0);
    addLine(monthlyRun("goodwill_books", period).id, {
      sourceId: "goodwill_books",
      channel: "goodwill_books",
      lineDate: days[days.length - 1]!,
      period,
      amountType: "statement_payment",
      amountCents: gbNet,
      reference: `GB-STMT-${period.replace("-", "")}`,
      memo: "Goodwill Books prior-month payment statement",
    });

    // Jewelry report: sales by (fake) supplier.
    const jewelryRun = monthlyRun("jewelry", period);
    for (const supplier of ["Supplier A", "Supplier B", "Supplier C", "Supplier D"]) {
      const lines = rng.int(3, 6);
      for (let i = 0; i < lines; i++) {
        addLine(jewelryRun.id, {
          sourceId: "jewelry",
          channel: "shopgoodwill",
          lineDate: rng.pick(days),
          period,
          amountType: "sale",
          amountCents: priceEnding99(rng.logNormal(6_000, 0.7)),
          reference: `JWL-${period.replace("-", "")}-${supplier.slice(-1)}${i + 1}`,
          memo: supplier,
        });
      }
    }
  }

  // ---- Unsold listed inventory and unlisted backlog (synthetic) -------------
  const unsoldSources: [string, number][] = [["shopgoodwill", 40], ["amazon", 30], ["ebay", 20], ["upright", 10]];
  // Listings still open today: recent ones dominate (older ones mostly sold).
  for (const d of dateRange("2026-05-01", END_DATE)) {
    const n = rng.count(70 * Math.exp(-daysBetween(d, END_DATE) / 50));
    for (let i = 0; i < n; i++) {
      itemSeq++;
      const listedAt = localToUtc(d, rng.int(8 * 3600, 18 * 3600));
      const sentAt = new Date(listedAt.getTime() - rng.logNormal(4, 0.7) * 86_400_000);
      const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * 86_400_000);
      const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * 86_400_000);
      const age = daysBetween(d, END_DATE);
      items.push({
        id: `item-${String(itemSeq).padStart(6, "0")}`,
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
        relistCount: Math.floor(age / 30),
      });
    }
  }
  for (const d of dateRange("2026-09-05", END_DATE)) {
    const n = rng.count(30);
    for (let i = 0; i < n; i++) {
      itemSeq++;
      const sentAt = localToUtc(d, rng.int(8 * 3600, 17 * 3600));
      const identifiedAt = new Date(sentAt.getTime() - rng.float() * 2 * 86_400_000);
      const donatedAt = new Date(identifiedAt.getTime() - rng.float() * 3 * 86_400_000);
      items.push({
        id: `item-${String(itemSeq).padStart(6, "0")}`,
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

  // ---- Labor hours (pseudonymous employees, synthetic) ----------------------
  let laborSeq = 0;
  for (const d of dates) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    for (const e of EMPLOYEES) {
      if (!rng.chance(weekday === 6 ? 0.4 : 0.88)) continue;
      laborSeq++;
      laborHours.push({
        id: `lh-${String(laborSeq).padStart(6, "0")}`,
        ingestRunId: null,
        employee: e.name,
        team: e.team,
        workDate: d,
        hours: Math.max(3, Math.round(rng.normal(7.5, 0.7) * 4) / 4),
      });
    }
  }

  // Row counts = data rows written to each synthetic file.
  for (const run of runs.values()) run.rowCount = (rowCounters.get(run.id) ?? 1) - 1;

  return {
    ingestRuns: [...runs.values()],
    orders,
    moneyLines,
    items,
    laborHours,
    exceptions,
  };
}
