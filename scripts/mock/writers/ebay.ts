/**
 * eBay Seller Hub "Orders" report, one file per day:
 * data/fixtures/ebay/ebay_YYYY-MM-DD.csv
 *
 * Layout = src/sources/__samples__/ebay_2026-09.csv: header, a line of empty
 * cells, one row per order line, a blank line, then the footer
 * "N record(s) downloaded,from …" and "Seller ID : …". LF line endings. Money
 * as "$12.34". Dates "Sep-30-26 23:45:00" (local, no zone). Buyer Name is
 * left empty (never exported by us; the parser ignores it anyway).
 *
 * Messy cases: 2026-09-15 uses the renamed header of the newer export
 * (Order ID / Buyer User ID / Item Price / Order Date, as in
 * ebay_2026-10-01.csv); 2026-09-14 is uploaded twice (exact duplicate file).
 * The report has no fee columns: eBay fees only reach the DB through Upright.
 */
import { csvRow, ebayDateTime, ebayDay, lines, usd } from "../format";
import { ordersOn, type MockModel, type MockOrder } from "../model";
import { ALL_DATES, PRIOR_YEAR_PERIODS, dailyUpload, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Sales Record Number", "Order Number", "Buyer Username", "Buyer Name", "Item Number", "Item Title",
  "Custom Label", "Quantity", "Sold For", "Shipping And Handling", "eBay Collected Tax", "Total Price",
  "eBay Collected Tax and Fees Included in Total", "Payment Method", "Sale Date", "Paid On Date",
  "Order Status", "Refund Amount",
];
/** The newer export renamed four columns (see ebay_2026-10-01 sample). */
const RENAMED: Record<string, string> = {
  "Order Number": "Order ID",
  "Buyer Username": "Buyer User ID",
  "Sold For": "Item Price",
  "Sale Date": "Order Date",
};
export const EBAY_RENAMED_DATE = "2026-09-15";
export const EBAY_DUPLICATE_DATE = "2026-09-14";
const SELLER_ID = "goodwill_michiana_test";

function row(o: MockOrder): string[] {
  const status = o.status === "cancelled" ? "Cancelled" : o.status === "refunded" ? "Refunded" : "Paid";
  const when = ebayDateTime(o.ts);
  return [
    String(o.salesRecord), o.orderId, o.buyerId ?? "", "", o.itemId, o.title, o.sku, String(o.quantity),
    usd(o.unitCents), usd(o.shippingCents), usd(o.taxCents), usd(o.grossCents + o.shippingCents + o.taxCents),
    "Yes", "eBay Managed Payments", when, when, status, o.refundCents ? usd(o.refundCents) : "",
  ];
}

export function writeEbay(model: MockModel): FixtureFile[] {
  const files: FixtureFile[] = [];
  const render = (orders: MockOrder[], header: string[], from: string, to: string) =>
    lines(
      [
        csvRow(header),
        csvRow(HEADER.map(() => "")),
        ...orders.map((o) => csvRow(row(o))),
        "",
        csvRow([`${orders.length} record(s) downloaded,from ${ebayDay(from)} to ${ebayDay(to)}`]),
        `Seller ID : ${SELLER_ID}`,
      ],
      "\n",
    );
  // Prior year: one report per month (no nightly pulls back then).
  for (const period of PRIOR_YEAR_PERIODS) {
    const orders = model.orders
      .filter((o) => o.stream === "ebay" && o.businessDate.startsWith(period))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.seq - b.seq);
    files.push({
      sourceId: "ebay",
      path: `ebay/ebay_${period}.csv`,
      content: render(orders, HEADER, `${period}-01`, lastDayOf(period)),
      uploadedAt: monthlyUpload(period, 4),
    });
  }
  for (const date of ALL_DATES) {
    const orders = ordersOn(model, "ebay", date);
    const header = date === EBAY_RENAMED_DATE ? HEADER.map((h) => RENAMED[h] ?? h) : HEADER;
    const content = render(orders, header, date, date);
    files.push({
      sourceId: "ebay",
      path: `ebay/ebay_${date}.csv`,
      content,
      uploadedAt: dailyUpload(date, 4),
      ...(date === EBAY_RENAMED_DATE ? { note: "renamed columns (Order ID, Buyer User ID, Item Price, Order Date)" } : {}),
    });
    if (date === EBAY_DUPLICATE_DATE) {
      files.push({
        sourceId: "ebay",
        path: `ebay/ebay_${date}_reupload.csv`,
        content, // byte-identical: the same export uploaded again
        uploadedAt: new Date(Date.parse(dailyUpload(date, 4)) + 2.5 * 3_600_000).toISOString(),
        note: "exact duplicate upload of ebay_2026-09-14.csv",
      });
    }
  }
  return files;
}
