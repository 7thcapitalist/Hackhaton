/**
 * Upright Labs "Paid Order Items" report, one file per day:
 * data/fixtures/upright/upright_YYYY-MM-DD.csv
 *
 * Layout = src/sources/__samples__/upright_2026-09.csv: header on row 1, one
 * row per paid item across channels, LF line endings, timestamps
 * "9/30/2026 11:45:00 PM" in the zone picked when generating (Indianapolis).
 *
 * Upright is the source of truth for orders. It lists every Goodwill Books and
 * "other" (Facebook Marketplace, Mercari) sale, plus the ShopGoodwill and eBay
 * orders listed through Upright, with the marketplace's own order and item
 * ids, so those rows collide with the marketplace files (duplicate_order).
 * Lister is a pseudonym; the parser never reads it.
 */
import { csvRow, dec, lines, uprightDate } from "../format";
import type { MockModel, MockOrder } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Channel", "Channel Item ID", "Channel Order ID", "Title", "Upright Product ID", "Quantity", "SKU",
  "Category", "Store", "Lister", "Upright Order ID", "Price", "Shipping", "Fees", "Refund Amount",
  "Ordered At", "Paid At", "Shipped At", "Listed At", "Buyer Username", "Sales Tax",
];
const STORE = "Michiana E-Com (test)";

function row(o: MockOrder): string[] {
  const shipped = o.shipment && o.shipment.shipDate === o.businessDate ? uprightDate(o.shipment.ts) : "";
  const listedAt = new Date(o.ts.getTime() - ((o.seq % 37) + 3) * 86_400_000 - (o.seq % 7) * 3_600_000);
  return [
    o.uprightChannel, o.itemId, o.orderId, o.title, o.uprightProductId, String(o.quantity), o.sku, o.category,
    STORE, o.lister, o.uprightOrderId, dec(o.unitCents), dec(o.shippingCents), dec(o.feeCents),
    o.refundCents ? dec(o.refundCents) : "", uprightDate(o.ts), uprightDate(o.ts), shipped, uprightDate(listedAt),
    o.buyerId ?? "", dec(o.taxCents),
  ];
}

export function writeUpright(model: MockModel): FixtureFile[] {
  const byDate = new Map<string, MockOrder[]>();
  for (const o of model.orders) {
    if (!o.inUpright) continue;
    const list = byDate.get(o.businessDate) ?? [];
    list.push(o);
    byDate.set(o.businessDate, list);
  }
  const byTime = (a: MockOrder, b: MockOrder) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq;
  const render = (orders: MockOrder[]) => lines([csvRow(HEADER), ...orders.map((o) => csvRow(row(o)))], "\n");
  // Prior year: the full-month report (slide 38), one per month.
  const monthly = PRIOR_YEAR_PERIODS.map((period) => ({
    sourceId: "upright",
    path: `upright/upright_${period}.csv`,
    content: render(model.orders.filter((o) => o.inUpright && o.businessDate.startsWith(period)).sort(byTime)),
    uploadedAt: monthlyUpload(period, 30),
  }));
  const daily = ALL_DATES.map((date) => {
    const orders = (byDate.get(date) ?? []).sort(byTime);
    const overlap = orders.filter((o) => o.stream === "ebay" || o.stream === "shopgoodwill").length;
    return {
      sourceId: "upright",
      path: `upright/upright_${date}.csv`,
      content: render(orders),
      uploadedAt: dailyUpload(date, 30),
      ...(date === "2026-09-20" ? { note: `${overlap} order(s) also in that day's eBay/ShopGoodwill files (every Upright file overlaps a little)` } : {}),
    };
  });
  return [...monthly, ...daily];
}
