/**
 * Upright Lister "Inventory / Products" export, one file per month (the
 * current month is partial): data/fixtures/upright_inventory/upright_inventory_YYYY-MM.csv
 *
 * Layout [guess, see docs/sources/upright_inventory.md]: header on line 1,
 * one row per product on hand during the month (listed before month end and
 * not sold before month start), state as of month end. Dates
 * "9/30/2026 11:45:00 PM" (local). Money "24.99". CRLF like Upright's report.
 */
import { localToUtc } from "../../../src/lib/views/dates";
import { csvRow, dec, lines, uprightDate } from "../format";
import { END_DATE, type MockModel } from "../model";
import type { OpsItem } from "../ops";
import { dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = [
  "Product ID", "SKU", "Title", "Category", "Status", "Marketplace", "Listed By", "List Price",
  "Quantity", "Created At", "Listed At", "Sold At", "Sold Price", "Relist Count",
];

/** UTC window [start, end) of a business month. */
export function monthWindow(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start: localToUtc(`${period}-01`, 0), end: localToUtc(next, 0) };
}

export function writeUprightInventory(model: MockModel): FixtureFile[] {
  const { items, itemPeriods } = model.ops;
  const productNo = new Map<OpsItem, number>(items.map((it, i) => [it, 7_000_000 + i]));
  return itemPeriods.map((period) => {
    const { start, end } = monthWindow(period);
    const rows = items.filter((it) => it.listedAt && it.listedAt < end && (!it.soldAt || it.soldAt >= start));
    const body = [
      csvRow(HEADER),
      ...rows.map((it) => {
        const listedAt = it.listedAt!;
        const sold = it.soldAt && it.soldAt < end ? it.soldAt : null;
        const ageDays = (end.getTime() - listedAt.getTime()) / 86_400_000;
        const relists = Math.min(it.relistCount, Math.floor(ageDays / 30));
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
          String(relists),
        ]);
      }),
    ];
    const current = period === END_DATE.slice(0, 7);
    return {
      sourceId: "upright_inventory",
      path: `upright_inventory/upright_inventory_${period}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: current ? dailyUpload(END_DATE, 35) : monthlyUpload(period, 30),
    };
  });
}
