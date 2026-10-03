/**
 * eBay Seller Hub "Orders" report, one file per day:
 * data/fixtures/ebay/ebay_YYYY-MM-DD.csv (prior year: one per month).
 *
 * Layout = the real US Orders report (docs/sources/ebay.md §1a): line 1 =
 * bare commas, line 2 = the 80-column header, line 3 = a padding row of
 * commas, one row per order line, then the footer "N,record(s) downloaded,
 * from … to …" and "Seller ID : …". LF line endings. Money "$12.34". Dates
 * "Sep-30-26 23:45:00" (seller local, no zone). Buyer name / email / address
 * columns are left empty: we never generate PII and the parser never reads
 * them.
 *
 * The real report has NO order status, refund or fee columns, so refunds and
 * fees are not in these files (they come through Upright, or eBay's
 * Transaction report / Finances API). Cancelled orders are not listed.
 *
 * Clean baseline: one file per day, standard headers. The renamed-header
 * variant (Order ID / Buyer User ID / Item Price / Order Date) and the exact
 * re-upload are live demo files in data/demo-uploads/ (ebayRenamedFile).
 */
import { csvRow, ebayDateTime, ebayDay, lines, usd } from "../format";
import { ordersOn, type MockModel, type MockOrder } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

export const EBAY_ORDERS_HEADER = [
  "Sales Record Number", "Order Number", "Buyer Username", "Buyer Name", "Buyer Email", "Buyer Note", "Buyer Address 1",
  "Buyer Address 2", "Buyer City", "Buyer State", "Buyer Zip", "Buyer Country", "Buyer Tax Identifier Name",
  "Buyer Tax Identifier Value", "Ship To Name", "Ship To Phone", "Ship To Address 1", "Ship To Address 2", "Ship To City",
  "Ship To State", "Ship To Zip", "Ship To Country", "Item Number", "Item Title", "Custom Label", "Sold Via Promoted Listings",
  "Quantity", "Sold For", "Shipping And Handling", "Item Location", "Item Zip Code", "Item Country",
  "eBay Collect And Remit Tax Rate", "eBay Collect And Remit Tax Type", "eBay Reference Name", "eBay Reference Value",
  "Tax Status", "Seller Collected Tax", "eBay Collected Tax", "Electronic Waste Recycling Fee", "Mattress Recycling Fee",
  "Battery Recycling Fee", "White Goods Disposal Tax", "Tire Recycling Fee", "Additional Fee", "eBay Collected Charges",
  "Total Price", "eBay Collected Tax Included in Total", "Payment Method", "Commitment Date", "Sale Date", "Paid On Date",
  "Ship By Date", "Minimum Estimated Delivery Date", "Maximum Estimated Delivery Date", "Shipped On Date", "Feedback Left",
  "Feedback Received", "My Item Note", "PayPal Transaction ID", "Shipping Service", "Tracking Number", "Transaction ID",
  "Variation Details", "Global Shipping Program", "Global Shipping Reference ID", "Click And Collect",
  "Click And Collect Reference Number", "eBay Plus", "Authenticity Verification Program", "Authenticity Verification Status",
  "Authenticity Verification Outcome Reason", "eBay Vault Program", "Vault Fulfillment Type", "eBay Fulfillment Program",
  "Tax City", "Tax State", "Tax Zip", "Tax Country", "eBay International Shipping",
];
/** The renamed variant (see ebay_2026-10-01 sample). */
const RENAMED: Record<string, string> = {
  "Order Number": "Order ID",
  "Buyer Username": "Buyer User ID",
  "Sold For": "Item Price",
  "Sale Date": "Order Date",
};
const SELLER_ID = "goodwill_michiana_test";
const IDX = new Map(EBAY_ORDERS_HEADER.map((h, i) => [h, i]));

/** One order line in the real layout. `values` by real header name. */
export function ebayRow(values: Record<string, string>): string[] {
  const out = EBAY_ORDERS_HEADER.map(() => "");
  for (const [k, v] of Object.entries(values)) {
    const i = IDX.get(k);
    if (i == null) throw new Error(`unknown eBay column ${k}`);
    out[i] = v;
  }
  return out;
}

function row(o: MockOrder): string[] {
  const when = ebayDateTime(o.ts);
  return ebayRow({
    "Sales Record Number": String(o.salesRecord), "Order Number": o.orderId, "Buyer Username": o.buyerId ?? "",
    "Item Number": o.itemId, "Item Title": o.title, "Custom Label": o.sku, "Sold Via Promoted Listings": "No",
    Quantity: String(o.quantity), "Sold For": usd(o.unitCents), "Shipping And Handling": usd(o.shippingCents),
    "Item Location": "South Bend, IN", "Item Zip Code": "46601", "Item Country": "US",
    "eBay Collect And Remit Tax Rate": "7.00%", "eBay Collect And Remit Tax Type": "SalesTax",
    "Seller Collected Tax": "$0.00", "eBay Collected Tax": usd(o.taxCents),
    "Total Price": usd(o.grossCents + o.shippingCents + o.taxCents), "eBay Collected Tax Included in Total": "Yes",
    "Payment Method": "eBay Managed Payments", "Sale Date": when, "Paid On Date": when,
    "Transaction ID": String(1_000_000_000 + o.seq), "Shipping Service": o.shipment ? o.shipment.service : "",
  });
}

/** Render an Orders report (real framing: comma line, header, padding, rows, footer). */
export function renderEbayOrders(rows: string[][], header: string[], from: string, to: string, records: number): string {
  const blank = csvRow(header.map(() => ""));
  return lines(
    [
      blank,
      csvRow(header),
      blank,
      ...rows.map((r) => csvRow(r)),
      csvRow([String(records), "record(s) downloaded", `from ${ebayDay(from)} to ${ebayDay(to)}`]),
      `Seller ID : ${SELLER_ID}`,
    ],
    "\n",
  );
}

export function writeEbay(model: MockModel): FixtureFile[] {
  const files: FixtureFile[] = [];
  const listed = (orders: MockOrder[]) => orders.filter((o) => o.status !== "cancelled");
  const render = (orders: MockOrder[], header: string[], from: string, to: string) =>
    renderEbayOrders(orders.map(row), header, from, to, orders.length);
  // Prior year: one report per month (no nightly pulls back then).
  for (const period of PRIOR_YEAR_PERIODS) {
    const orders = listed(
      model.orders
        .filter((o) => o.stream === "ebay" && o.businessDate.startsWith(period))
        .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq),
    );
    files.push({
      sourceId: "ebay",
      path: `ebay/ebay_${period}.csv`,
      content: render(orders, EBAY_ORDERS_HEADER, `${period}-01`, lastDayOf(period)),
      uploadedAt: monthlyUpload(period, 4),
    });
  }
  for (const date of ALL_DATES) {
    files.push({
      sourceId: "ebay",
      path: `ebay/ebay_${date}.csv`,
      content: render(listed(ordersOn(model, "ebay", date)), EBAY_ORDERS_HEADER, date, date),
      uploadedAt: dailyUpload(date, 4),
    });
  }
  return files;
}

/** One day's Orders report with the renamed headers (demo upload 04; not in the baseline). */
export function ebayRenamedFile(model: MockModel, date: string): string {
  const orders = model.orders.filter((o) => o.stream === "ebay" && o.businessDate === date && o.status !== "cancelled")
    .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq);
  return renderEbayOrders(orders.map(row), EBAY_ORDERS_HEADER.map((h) => RENAMED[h] ?? h), date, date, orders.length);
}
