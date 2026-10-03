/**
 * Parser registry. The ingest service picks a parser from here, either by
 * explicit source id or by asking each parser whether it accepts the file.
 */
import { amazonParser } from "./amazon";
import { cashmonkeyParser } from "./cashmonkey";
import { ebayParser } from "./ebay";
import { fedexParser } from "./fedex";
import { goodwillBooksParser } from "./goodwill_books";
import { jewelryParser } from "./jewelry";
import { shippingOsmPbEasypostParser } from "./shipping_osm_pb_easypost";
import { shopgoodwillParser } from "./shopgoodwill";
import type { RawTable, SourceParser } from "./types";
import { uprightParser } from "./upright";

// Order matters for auto-detect: the first parser that accepts a file wins.
// Marketplace parsers first: their headers are the best documented.
export const parsers: SourceParser[] = [
  amazonParser,
  ebayParser,
  shopgoodwillParser,
  uprightParser,
  cashmonkeyParser,
  jewelryParser,
  shippingOsmPbEasypostParser,
  fedexParser,
  goodwillBooksParser,
];

export function getParser(sourceId: string): SourceParser | undefined {
  return parsers.find((p) => p.sourceId === sourceId);
}

/**
 * First registered parser whose `accepts()` returns true. A parser that
 * throws inside `accepts()` is treated as "no".
 */
export function detectParser(table: RawTable, fileName: string): SourceParser | undefined {
  return parsers.find((p) => {
    try {
      return p.accepts(table, fileName);
    } catch {
      return false;
    }
  });
}
