/**
 * Upright Lister "Inventory / Products" export, one file per business day:
 * data/fixtures/upright_inventory/upright_inventory_YYYY-MM-DD.csv
 *
 * Cadence: daily (scheduled email export). The first day of the range is a
 * full export (every product on hand that day); after that each file lists
 * the products that changed that day: listed, sold, or relisted. Rows carry
 * the product's state at the end of that day; ingest merges by SKU (a null
 * never erases a known value, relist_count only grows), so the result is the
 * same as the old monthly snapshots.
 *
 * Layout [guess, see docs/sources/upright_inventory.md]: header on line 1.
 * Dates "9/30/2026 11:45:00 PM" (local). Money "24.99". CRLF like Upright's report.
 */
import { csvRow, dec, lines, uprightDate } from "../format";
import { START_DATE, type MockModel } from "../model";
import type { OpsItem } from "../ops";
import { ALL_DATES, dailyUpload } from "../schedule";
import type { FixtureFile } from "../types";
import { dayWindow } from "./production_tracking";

const HEADER = [
  "Product ID", "SKU", "Title", "Category", "Status", "Marketplace", "Listed By", "List Price",
  "Quantity", "Created At", "Listed At", "Sold At", "Sold Price", "Relist Count",
];

/** Relists shown by an export taken at `at` (one relist per 30 days listed, capped). */
const relistsAt = (it: OpsItem, at: Date) =>
  it.listedAt && it.listedAt < at ? Math.min(it.relistCount, Math.floor((at.getTime() - it.listedAt.getTime()) / 86_400_000 / 30)) : 0;

export function writeUprightInventory(model: MockModel): FixtureFile[] {
  const { items } = model.ops;
  const productNo = new Map<OpsItem, number>(items.map((it, i) => [it, 7_000_000 + i]));
  return ALL_DATES.map((date) => {
    const { start, end } = dayWindow(date);
    const first = date === START_DATE;
    const inDay = (d: Date | null) => !!d && d >= start && d < end;
    const rows = items.filter((it) => {
      if (!it.listedAt || it.listedAt >= end) return false;
      if (first) return !it.soldAt || it.soldAt >= start;
      return inDay(it.listedAt) || inDay(it.soldAt) || relistsAt(it, end) !== relistsAt(it, start);
    });
    const body = [
      csvRow(HEADER),
      ...rows.map((it) => {
        const listedAt = it.listedAt!;
        const sold = it.soldAt && it.soldAt < end ? it.soldAt : null;
        return csvRow([
          String(productNo.get(it)),
          it.id,
          `${it.category} item ${it.id}`,
          it.category,
          sold ? "Sold" : "Active",
          it.marketplace ?? "",
          it.listedBy ?? "",
          it.listPriceCents == null ? "" : dec(it.listPriceCents),
          "1",
          uprightDate(new Date(listedAt.getTime() - 12 * 60_000)),
          uprightDate(listedAt),
          sold ? uprightDate(sold) : "",
          sold && it.salePriceCents != null ? dec(it.salePriceCents) : "",
          String(relistsAt(it, end)),
        ]);
      }),
    ];
    return {
      sourceId: "upright_inventory",
      path: `upright_inventory/upright_inventory_${date}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: dailyUpload(date, 35),
    };
  });
}
