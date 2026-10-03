/**
 * "Jewelry Report" (after the Co-Pivot step fills Supplier), one file per
 * closed month: data/fixtures/jewelry/jewelry_YYYY-MM.csv
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
 * Messy cases (September): one row without Supplier (Co-Pivot not run for it)
 * and one return (negative price).
 */
import { csvRow, lines, monthName, usd } from "../format";
import type { MockModel } from "../model";
import { MONTHLY_PERIODS, monthlyUpload } from "../schedule";
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

export function writeJewelry(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
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
      csvRow([`Jewelry Report - ${monthName(period)} ${period.slice(0, 4)}`, ...EMPTY.slice(1)]),
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
      uploadedAt: monthlyUpload(period, 5),
      ...(period === "2026-09"
        ? { note: `${onSgw.length} ShopGoodwill items already in the ShopGoodwill files (dedupe, no new revenue); one row without Supplier; one return` }
        : {}),
    };
  });
}
