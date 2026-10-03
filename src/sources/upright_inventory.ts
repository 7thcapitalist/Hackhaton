/**
 * Upright Lister inventory / products export: when each item was listed and
 * sold, by whom (employee pseudonym), at what price, how often relisted.
 * Feeds listings created, listings per employee, days to sell, sell-through,
 * aged/unsold inventory and relisted inventory.
 *
 * Layout [guess: Upright's inventory export columns are not public; the
 * Paid Order Items report is documented, see docs/sources/upright.md]
 *   Header on line 1:
 *     Product ID, SKU, Title, Category, Status, Marketplace, Listed By,
 *     List Price, Quantity, Created At, Listed At, Sold At, Sold Price, Relist Count
 *   Dates "9/30/2026 11:45:00 PM" are Indianapolis wall time. Money "24.99".
 *   SKU = the production item tag, so ingest merges with production tracking.
 *
 * Emits items only: revenue comes from the order reports, never from here.
 */
import type { ParseContext, ParseResult, RawTable, SourceParser } from "./types";
import { isBlankRow, toCents } from "./_shared/table";
import { cellAt, channelOf, columns, emptyResult, headerRowOf, isoOf, num, periodFromName } from "./_ops";

const COLS = {
  sku: ["SKU", "Item Tag", "Custom Label"],
  category: ["Category"],
  status: ["Status", "Product Status"],
  marketplace: ["Marketplace", "Channel", "Listed On"],
  listedBy: ["Listed By", "Lister", "User"],
  listPrice: ["List Price", "Price"],
  listedAt: ["Listed At", "Listed Date", "Date Listed"],
  soldAt: ["Sold At", "Sold Date", "Date Sold"],
  soldPrice: ["Sold Price", "Sale Price"],
  relists: ["Relist Count", "Relists", "Times Relisted"],
};
const REQUIRED = [["SKU", "Listed At", "Relist Count"], ["SKU", "Listed At", "Listed By"]];

/** Marketplace → the source that reports that channel's orders. */
function channelSource(label: string): string | null {
  if (!label) return null;
  const ch = channelOf(label);
  return ch === "other" ? "upright" : ch;
}

export const uprightInventoryParser: SourceParser = {
  sourceId: "upright_inventory",
  version: "0.1.0",

  accepts(table: RawTable): boolean {
    return headerRowOf(table, REQUIRED) >= 0;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const h = headerRowOf(table, REQUIRED);
    const result = emptyResult(h, table);
    if (h < 0) {
      result.warnings.push({ message: "Upright inventory: header not found (need SKU + Listed At + Relist Count or Listed By)." });
      return result;
    }
    const c = columns(table, h, COLS);
    result.items = [];
    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      if (isBlankRow(row)) continue;
      const id = cellAt(row, c.sku);
      if (!id) {
        result.warnings.push({ row: i + 1, message: "Skipped row: no SKU." });
        continue;
      }
      const listedAt = isoOf(cellAt(row, c.listedAt));
      const soldAt = isoOf(cellAt(row, c.soldAt));
      if (/sold/i.test(cellAt(row, c.status)) && !soldAt) {
        result.warnings.push({ row: i + 1, message: `Item ${id}: status Sold but no Sold At date.` });
      }
      result.items.push({
        id,
        category: cellAt(row, c.category) || null,
        donatedAt: null,
        identifiedAt: null,
        sentToEcomAt: null,
        listedAt,
        soldAt,
        listedBy: cellAt(row, c.listedBy) || null,
        channelSourceId: channelSource(cellAt(row, c.marketplace)),
        listPriceCents: toCents(cellAt(row, c.listPrice)),
        salePriceCents: soldAt ? toCents(cellAt(row, c.soldPrice)) : null,
        relistCount: Math.max(0, Math.round(num(cellAt(row, c.relists)) ?? 0)),
      });
    }
    result.period = ctx.period ?? periodFromName(ctx.fileName);
    return result;
  },
};
