/**
 * "Jewelry Report" (after the Co-Pivot step fills Supplier), one file per
 * closed month: data/fixtures/jewelry/jewelry_YYYY-MM.csv
 *
 * Layout = src/sources/__samples__/other/jewelry_2026-09.csv: a title line, an
 * empty line, the header, one row per item, an empty line and a "Grand Total"
 * row (pivot style). LF line endings, ISO dates, "$34.99" money.
 *
 * Messy cases (September): one row without Supplier (Co-Pivot not run for it)
 * and one return (negative price).
 */
import { csvRow, lines, monthName, usd } from "../format";
import type { MockModel } from "../model";
import { MONTHLY_PERIODS, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Sale Date", "Order ID", "Item ID", "Description", "Category", "Sold Price", "Shipping", "Fees", "Supplier"];
const EMPTY = HEADER.map(() => "");

export function writeJewelry(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
    const rows = model.jewelry.filter((j) => j.date.startsWith(period));
    const sum = (f: (j: (typeof rows)[number]) => number) => rows.reduce((s, j) => s + f(j), 0);
    const body = [
      csvRow([`Jewelry Report - ${monthName(period)} ${period.slice(0, 4)}`, ...EMPTY.slice(1)]),
      csvRow(EMPTY),
      csvRow(HEADER),
      ...rows.map((j) =>
        csvRow([
          j.date, j.orderId, j.itemId, j.description, j.category, usd(j.priceCents), usd(j.shippingCents),
          j.priceCents < 0 ? "" : usd(j.feeCents), j.supplier,
        ]),
      ),
      csvRow(EMPTY),
      csvRow(["Grand Total", "", "", "", "", usd(sum((j) => j.priceCents)), usd(sum((j) => j.shippingCents)), usd(sum((j) => j.feeCents)), ""]),
    ];
    return {
      sourceId: "jewelry",
      path: `jewelry/jewelry_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: monthlyUpload(period, 5),
      ...(period === "2026-09" ? { note: "one row without Supplier; one return" } : {}),
    };
  });
}
