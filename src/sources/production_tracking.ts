/**
 * Goodwill production tracking: when each item was donated, identified for
 * e-commerce and sent to the e-commerce team. Feeds items_identified,
 * items_sent_to_ecom, days donation→listing and the unlisted backlog.
 *
 * Layout [guess: internal system, no public sample; docs/sources/production_tracking.md]
 *   Optional title lines, then a header with at least Item Tag + Sent to E-Com:
 *     Item Tag, Category, Donation Site, Donated, Identified for E-Com, Sent to E-Com, Stage
 *   Dates without a zone are Indianapolis wall time.
 *   Item Tag = the SKU the lister enters in Upright, so the Upright inventory
 *   file fills listed/sold for the same item (ingest merges by item id).
 *
 * Emits items only (no money). Only timestamps owned by this system are set;
 * listed/sold stay null here and never erase Upright's values.
 */
import type { ParseContext, ParseResult, RawTable, SourceParser } from "./types";
import { isBlankRow } from "./_shared/table";
import { cellAt, columns, emptyResult, headerRowOf, isoOf, periodFromName } from "./_ops";

const COLS = {
  tag: ["Item Tag", "Tag", "Item ID", "SKU", "Barcode"],
  category: ["Category", "Department"],
  donated: ["Donated", "Donation Date", "Donated At", "Received"],
  identified: ["Identified for E-Com", "Identified", "Identified At", "E-Com Pulled"],
  sent: ["Sent to E-Com", "Sent To Ecom", "Sent At", "Transferred to E-Com"],
};
const REQUIRED = [["Item Tag", "Sent to E-Com"], ["Item Tag", "Sent To Ecom"], ["Tag", "Sent to E-Com"]];

export const productionTrackingParser: SourceParser = {
  sourceId: "production_tracking",
  version: "0.1.0",

  accepts(table: RawTable): boolean {
    return headerRowOf(table, REQUIRED) >= 0;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const h = headerRowOf(table, REQUIRED);
    const result = emptyResult(h, table);
    if (h < 0) {
      result.warnings.push({ message: "Production tracking: header not found (need Item Tag + Sent to E-Com)." });
      return result;
    }
    const c = columns(table, h, COLS);
    result.items = [];
    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      if (isBlankRow(row)) continue;
      const id = cellAt(row, c.tag);
      const sent = isoOf(cellAt(row, c.sent));
      if (!id) {
        result.warnings.push({ row: i + 1, message: "Skipped row: no item tag." });
        continue;
      }
      if (!sent && cellAt(row, c.sent)) result.warnings.push({ row: i + 1, message: `Item ${id}: bad Sent to E-Com date "${cellAt(row, c.sent)}".` });
      result.items.push({
        id,
        category: cellAt(row, c.category) || null,
        donatedAt: isoOf(cellAt(row, c.donated)),
        identifiedAt: isoOf(cellAt(row, c.identified)),
        sentToEcomAt: sent,
        listedAt: null,
        soldAt: null,
        listedBy: null,
        channelSourceId: null,
        listPriceCents: null,
        salePriceCents: null,
        relistCount: 0,
      });
    }
    result.period = ctx.period ?? periodFromName(ctx.fileName);
    return result;
  },
};
