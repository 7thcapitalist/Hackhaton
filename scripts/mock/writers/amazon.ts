/**
 * Amazon Seller Central "Date Range Transaction" report, one file per day:
 * data/fixtures/amazon/amazon_YYYY-MM-DD.csv
 *
 * Layout = src/sources/__samples__/amazon_2026-09.csv: 7 quoted disclaimer
 * lines, then the header, CRLF line endings, "date/time" always quoted and in
 * Pacific time with a zone ("Sep 30, 2026 8:45:12 PM PDT"). Fees are negative,
 * marketplace-facilitator tax is collected and withheld in the same row.
 *
 * 2026 columns Transaction Status / Transaction Release Date are included
 * (nightly files: Deferred; prior-year month files: Released).
 *
 * A file every day (clean baseline). Normal case: a Refund row for an order
 * of an earlier file (LATE_REFUND_DATE). The unknown "Liquidations" type is a
 * live demo upload (data/demo-uploads/02_amazon_2026-10-02_unknown_type.csv).
 */
import { addDays, daysBetween } from "../../../src/lib/views/dates";
import { amazonDate, csvRow, dec, lines } from "../format";
import { LATE_REFUND_DATE, type AmazonEvent, type MockModel, type MockOrder } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const PREAMBLE = [
  "Includes Amazon Marketplace, Fulfillment by Amazon (FBA), and Amazon Webstore transactions",
  "All amounts in USD, unless specified",
  "Definitions:",
  "Sales tax collected: Includes sales tax collected from buyers for product sales, shipping, and gift wrap.",
  "Selling fees: Includes variable closing fees and referral fees.",
  "Other transaction fees: Includes sales tax collection fees.",
  'Other: Includes non-order transaction amounts. For more details, see the "Type" and "Description" columns for each order ID.',
];

const HEADER = [
  "date/time", "settlement id", "type", "order id", "sku", "description", "quantity", "marketplace",
  "fulfillment", "order city", "order state", "order postal", "tax collection model", "product sales",
  "product sales tax", "shipping credits", "shipping credits tax", "gift wrap credits", "giftwrap credits tax",
  "Regulatory Fee", "promotional rebates", "promotional rebates tax", "marketplace withheld tax", "selling fees",
  "fba fees", "other transaction fees", "other", "total", "Transaction Status", "Transaction Release Date",
];
const QUOTED = new Set([0]);

/** Settlements run 14 days; a Transfer row closes the previous one. */
function settlementId(date: string, isTransfer: boolean): string {
  const idx = Math.floor(daysBetween("2026-07-24", date) / 14) - (isTransfer ? 1 : 0);
  return String(18_800_000_000 + idx);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 2026 columns: in a nightly file, order money is still "Deferred" (released
 * 7 days after posting); month files of the prior year are all "Released".
 */
function release(fileKey: string, date: string): [string, string] {
  if (fileKey.length === 7) return ["Released", ""];
  const r = addDays(date, 7);
  return ["Deferred", `${MON[Number(r.slice(5, 7)) - 1]} ${Number(r.slice(8, 10))}, ${r.slice(0, 4)}`];
}

function orderRow(o: MockOrder): string[] {
  const total = o.grossCents + o.shippingCents - o.origFeeCents;
  return [
    amazonDate(o.ts), settlementId(o.businessDate, false), "Order", o.orderId, o.sku, o.title, String(o.quantity),
    "amazon.com", "Seller", "", "", "", "MarketplaceFacilitator",
    dec(o.grossCents), dec(o.productTaxCents), dec(o.shippingCents), dec(o.shippingTaxCents),
    "0", "0", "0", "0.00", "0", dec(-o.taxCents), dec(-o.origFeeCents), "0.00", "0.00", "0.00", dec(total),
  ];
}

function refundRow(o: MockOrder, date: string): string[] {
  const feeBack = o.origFeeCents - o.feeCents;
  const total = -(o.grossCents + o.shippingCents) + feeBack;
  return [
    amazonDate(o.refundTs!), settlementId(date, false), "Refund", o.orderId, o.sku, o.title, String(o.quantity),
    "amazon.com", "Seller", "", "", "", "MarketplaceFacilitator",
    dec(-o.grossCents), dec(-o.productTaxCents), dec(-o.shippingCents), dec(-o.shippingTaxCents),
    "0", "0", "0", "0.00", "0", dec(o.taxCents), dec(feeBack), "0.00", "0.00", "0.00", dec(total),
  ];
}

function eventRow(e: AmazonEvent): string[] {
  const isTransfer = e.type === "Transfer";
  return [
    amazonDate(e.ts), settlementId(e.businessDate, isTransfer), e.type, "", "", e.description, "",
    "", "", "", "", "", "",
    "0.00", "0.00", "0.00", "0.00", "0", "0", "0", "0.00", "0", "0.00", "0.00", "0.00", "0.00",
    isTransfer ? "0.00" : dec(e.amountCents), dec(e.amountCents),
  ];
}

/** A Date Range Transaction report holding only `events` (demo upload 02; not in the baseline). */
export function amazonEventsFile(events: AmazonEvent[]): string {
  const rows = [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime()).map((e) => [...eventRow(e), "Released", ""]);
  return lines([...PREAMBLE.map((p) => csvRow([p], new Set([0]))), csvRow(HEADER), ...rows.map((r) => csvRow(r, QUOTED))], "\r\n");
}

export function writeAmazon(model: MockModel): FixtureFile[] {
  const files: FixtureFile[] = [];
  const amazon = model.orders.filter((o) => o.stream === "amazon");
  // Nightly files (2026), then one date-range file per prior-year month.
  const specs = [
    ...ALL_DATES.map((d) => ({ key: d, match: (x: string) => x === d, upload: dailyUpload(d, 2) })),
    ...PRIOR_YEAR_PERIODS.map((p) => ({ key: p, match: (x: string) => x.startsWith(p), upload: monthlyUpload(p, 2) })),
  ];
  for (const { key, match, upload } of specs) {
    const rows: { t: number; seq: number; cells: string[] }[] = [];
    let late = false;
    for (const o of amazon) {
      if (match(o.businessDate)) rows.push({ t: o.ts.getTime(), seq: o.seq, cells: [...orderRow(o), ...release(key, o.businessDate)] });
      if (o.status === "refunded" && o.refundTs) {
        const refundDate = o.lateRefund ? LATE_REFUND_DATE : o.businessDate;
        if (match(refundDate)) {
          rows.push({ t: o.refundTs.getTime(), seq: o.seq, cells: [...refundRow(o, refundDate), ...release(key, refundDate)] });
          late ||= o.lateRefund;
        }
      }
    }
    for (const e of model.amazonEvents) {
      if (match(e.businessDate)) rows.push({ t: e.ts.getTime(), seq: 0, cells: [...eventRow(e), "Released", ""] });
    }
    rows.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const body = [
      ...PREAMBLE.map((p) => csvRow([p], new Set([0]))),
      csvRow(HEADER),
      ...rows.map((r) => csvRow(r.cells, QUOTED)),
    ];
    const notes: string[] = [];
    if (late) notes.push("refund row for an order in an earlier file");
    files.push({
      sourceId: "amazon",
      path: `amazon/amazon_${key}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: upload,
      ...(notes.length ? { note: notes.join("; ") } : {}),
    });
  }
  return files;
}
