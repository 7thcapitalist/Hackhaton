/**
 * Upright Labs "Paid Order Items" report, one file per day:
 * data/fixtures/upright/upright_YYYY-MM-DD.csv (prior year: one per month).
 *
 * Layout = the real 34-column report (docs/sources/upright.md §1, A–AH):
 * header on row 1, one row per paid item across channels, LF line endings,
 * timestamps "9/30/2026 8:45:00 PM" in America/Los_Angeles (the zone Upright
 * recommends "for a closer match to Shopgoodwill's reports"; the parser's
 * default), money without "$".
 *
 * Order-level columns (Order Total … Refund Amount, Order Channel Fee Or
 * Credit Amount) repeat on every item row of a multi-item order, like the real
 * report. Messy case: on some days two Mercari sales are rendered as ONE
 * two-item order (same Channel Order ID, order money repeated on both rows).
 *
 * Upright is the source of truth for orders. It lists every Goodwill Books and
 * "other" (Facebook Marketplace, Mercari) sale, plus the ShopGoodwill and eBay
 * orders listed through Upright, with the marketplace's own order and item
 * ids, so those rows collide with the marketplace files (duplicate_order).
 * Poster is a pseudonym; the parser never reads it.
 */
import { csvRow, dec, lines, PACIFIC, uprightDate } from "../format";
import type { MockModel, MockOrder } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Channel", "Channel Item ID", "Channel Order ID", "Upright Order ID", "Upright Product ID", "Quantity",
  "Inventory Location", "Product SKU", "Product Title", "Product Category", "Supplier", "Product Carrier",
  "Order Shipping Method", "Order Item Price", "Order Item Subtotal", "Order Ordered At", "Order Paid At",
  "Order Shipped At", "Order Cancelled At", "Order Payment Id", "Order Payment Type", "Order Total",
  "Order Subtotal", "Order Shipping Total", "Order Handling Total", "Order Final Value Fee",
  "Order Payment Processing Fee", "Refund Amount", "Poster", "Product Weight", "Channel Buyer ID",
  "Secondary Channel Order ID", "Currency Code", "Order Channel Fee Or Credit Amount",
];
const SUPPLIER = "Michiana E-Com (test)";
const HANDLING = 200; // ShopGoodwill handling, same split as the ShopGoodwill writer

/** An order as Upright prints it: one or more items sharing order-level money. */
interface UprightOrder {
  head: MockOrder;
  items: MockOrder[];
}

const t = (d: Date) => uprightDate(d, PACIFIC);

function render(orders: UprightOrder[]): string {
  const rows: string[] = [csvRow(HEADER)];
  for (const { head, items } of orders) {
    const sum = (f: (o: MockOrder) => number) => items.reduce((a, o) => a + f(o), 0);
    const subtotal = sum((o) => o.grossCents);
    const shippingAll = sum((o) => o.shippingCents);
    const tax = sum((o) => o.taxCents);
    const fee = sum((o) => o.feeCents);
    const refund = sum((o) => o.refundCents);
    const isSgw = head.channel === "shopgoodwill";
    const handling = isSgw ? Math.min(HANDLING, shippingAll) : 0;
    const shipping = shippingAll - handling;
    const fvf = head.channel === "ebay" ? fee : 0;
    const processing = isSgw ? fee : 0;
    const channelFee = head.channel !== "ebay" && !isSgw ? fee : 0;
    const shipped = head.shipment && head.shipment.shipDate === head.businessDate ? t(head.shipment.ts) : "";
    const method = head.shipment ? head.shipment.carrier : "Pickup";
    for (const o of items) {
      rows.push(
        csvRow([
          o.uprightChannel, o.itemId, head.orderId, head.uprightOrderId, o.uprightProductId, String(o.quantity),
          `BIN-${String(o.seq % 400).padStart(3, "0")}`, o.sku, o.title, `${o.category}`, SUPPLIER,
          o.shipment ? o.shipment.carrier : "", method, dec(o.unitCents), dec(o.grossCents), t(head.ts), t(head.ts),
          shipped, "", head.channel === "ebay" ? `PAY-${head.seq}` : "", head.channel === "ebay" ? "eBay Managed Payments" : "Stripe",
          dec(subtotal + shipping + handling + tax), dec(subtotal), dec(shipping), dec(handling), dec(fvf), dec(processing),
          dec(refund), o.lister, `${(1 + (o.seq % 40) / 10).toFixed(1)}`, head.buyerId ?? "", "", "USD",
          channelFee ? dec(channelFee) : "",
        ]),
      );
    }
  }
  return lines(rows, "\n");
}

/** An Upright report for `orders` as single-item orders (demo upload 03; not in the baseline). */
export function uprightFileOf(orders: MockOrder[]): string {
  return render(orders.map((o) => ({ head: o, items: [o] })));
}

/** Group a day's items into Upright orders; merge some Mercari pairs into two-item orders. */
function group(items: MockOrder[], date: string): UprightOrder[] {
  const out: UprightOrder[] = [];
  const merge = Number(date.slice(8, 10)) % 5 === 0; // every 5th day of the month
  let mercariHead: UprightOrder | null = null;
  for (const o of items) {
    if (merge && o.uprightChannel === "Mercari" && o.status === "paid") {
      if (mercariHead) {
        mercariHead.items.push(o);
        mercariHead = null;
        continue;
      }
      mercariHead = { head: o, items: [o] };
      out.push(mercariHead);
      continue;
    }
    out.push({ head: o, items: [o] });
  }
  return out;
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
  // Prior year: the full-month report (slide 38), one per month.
  const monthly = PRIOR_YEAR_PERIODS.map((period) => ({
    sourceId: "upright",
    path: `upright/upright_${period}.csv`,
    content: render(
      model.orders
        .filter((o) => o.inUpright && o.businessDate.startsWith(period))
        .sort(byTime)
        .map((o) => ({ head: o, items: [o] })),
    ),
    uploadedAt: monthlyUpload(period, 30),
  }));
  const daily = ALL_DATES.map((date) => {
    const orders = (byDate.get(date) ?? []).sort(byTime);
    const grouped = group(orders, date);
    const overlap = orders.filter((o) => o.stream === "ebay" || o.stream === "shopgoodwill").length;
    const multi = grouped.filter((g) => g.items.length > 1).length;
    const notes: string[] = [];
    if (date === "2026-09-20") notes.push(`${overlap} order(s) also in that day's eBay/ShopGoodwill files (every Upright file overlaps a little)`);
    if (date === "2026-09-15" && multi) notes.push(`${multi} two-item Mercari order(s): order-level money repeated on both item rows`);
    return {
      sourceId: "upright",
      path: `upright/upright_${date}.csv`,
      content: render(grouped),
      uploadedAt: dailyUpload(date, 30),
      ...(notes.length ? { note: notes.join("; ") } : {}),
    };
  });
  return [...monthly, ...daily];
}
