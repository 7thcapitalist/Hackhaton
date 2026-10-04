/**
 * "Jewelry Report" (after the Co-Pivot step fills Supplier), one file per
 * finished day: data/fixtures/jewelry/jewelry_YYYY-MM-DD.csv (prior year:
 * one per month, jewelry_YYYY-MM.csv).
 *
 * Layout (guess, docs/sources/jewelry.md): a title line, an empty line, the
 * header, one row per item sold, an empty line and a "Grand Total" row
 * (pivot style). LF line endings, ISO dates, "$34.99" money.
 *
 * What it lists: the month's fine jewelry and watches (≥ $90) sold on
 * ShopGoodwill, with ShopGoodwill's own order and item ids, so they are
 * ALREADY in the ShopGoodwill (or Upright) files and must not add revenue
 * (dedupe drops them); plus the jewelry counter's own sales (model.jewelry,
 * Marketplace "Jewelry Counter" → channel other), which no other file has.
 *
 * Normal case (September): one return (negative price). Every row has its
 * Supplier; a row without one is demo upload 05 (jewelryNoSupplierFile).
 */
import { csvRow, lines, monthName, usDay, usd } from "../format";
import type { MockModel } from "../model";
import { DONE_DATES, PRIOR_YEAR_PERIODS, dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Sale Date", "Marketplace", "Order ID", "Item ID", "Description", "Category", "Sold Price", "Shipping", "Fees", "Supplier"];
const EMPTY = HEADER.map(() => "");
const SUPPLIERS = ["Store 04", "Store 07", "Store 12", "Outlet DC"];
const FINE_JEWELRY_CENTS = 9_000;

interface Row {
  date: string;
  market: string;
  orderId: string;
  itemId: string;
  description: string;
  category: string;
  priceCents: number;
  shippingCents: number;
  feeCents: number;
  supplier: string;
}

/**
 * Prior year: one file per month. Current year: the internal report can be
 * run for any range, so it is pulled DAILY (one file per finished day; the
 * title line names the day).
 */
export function writeJewelry(model: MockModel): FixtureFile[] {
  const specs = [
    ...PRIOR_YEAR_PERIODS.map((p) => ({ key: p, title: `${monthName(p)} ${p.slice(0, 4)}`, upload: monthlyUpload(p, 5) })),
    ...DONE_DATES.map((d) => ({ key: d, title: usDay(d), upload: dailyUpload(d, 5) })),
  ];
  return specs.map(({ key: period, title, upload }) => {
    const counter: Row[] = model.jewelry
      .filter((j) => j.date.startsWith(period))
      .map((j) => ({ ...j, market: "Jewelry Counter" }));
    const onSgw: Row[] = model.orders
      .filter(
        (o) =>
          o.stream === "shopgoodwill" && o.status === "paid" && o.businessDate.startsWith(period) &&
          (o.category === "Jewelry" || o.category === "Watches") && o.grossCents >= FINE_JEWELRY_CENTS,
      )
      .map((o) => ({
        date: o.businessDate, market: "ShopGoodwill", orderId: o.orderId, itemId: o.itemId, description: o.title,
        category: o.category, priceCents: o.grossCents, shippingCents: o.shippingCents, feeCents: o.feeCents,
        supplier: SUPPLIERS[o.seq % SUPPLIERS.length]!,
      }));
    const rows = [...counter, ...onSgw].sort((a, b) => a.date.localeCompare(b.date) || a.orderId.localeCompare(b.orderId));
    const sum = (f: (j: Row) => number) => rows.reduce((s, j) => s + f(j), 0);
    const body = [
      csvRow([`Jewelry Report - ${title}`, ...EMPTY.slice(1)]),
      csvRow(EMPTY),
      csvRow(HEADER),
      ...rows.map((j) =>
        csvRow([
          j.date, j.market, j.orderId, j.itemId, j.description, j.category, usd(j.priceCents), usd(j.shippingCents),
          j.priceCents < 0 ? "" : usd(j.feeCents), j.supplier,
        ]),
      ),
      csvRow(EMPTY),
      csvRow(["Grand Total", "", "", "", "", "", usd(sum((j) => j.priceCents)), usd(sum((j) => j.shippingCents)), usd(sum((j) => j.feeCents)), ""]),
    ];
    return {
      sourceId: "jewelry",
      path: `jewelry/jewelry_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: upload,
    };
  });
}

/** A one-day report where one row lost its Supplier (demo upload 05; not in the baseline). */
export function jewelryNoSupplierFile(model: MockModel, date: string): string {
  const file = writeJewelry(model).find((f) => f.path === `jewelry/jewelry_${date}.csv`);
  if (!file) throw new Error(`no jewelry file for ${date}`);
  const rows = file.content.split("\n");
  const i = rows.findIndex((r, k) => k > 2 && /,Store \d+$|,Outlet DC$/.test(r));
  if (i < 0) throw new Error(`no jewelry row with a Supplier on ${date}`);
  rows[i] = rows[i]!.replace(/,[^,]*$/, ",");
  return rows.join("\n");
}
