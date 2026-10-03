/**
 * Parser registry. The ingest service picks a parser from here, either by
 * explicit source id or by asking each parser whether it accepts the file.
 *
 * JSON API parsers (ebay_api, easypost_api) share their source id with the
 * file parser of the same platform. They sit in their own list and are only
 * consulted for JSON documents (see the JSON section of ./types.ts), so CSV and
 * XLSX detection is exactly as before.
 */
import { amazonParser } from "./amazon";
import { amazonApiParser } from "./amazon_api";
import { cashmonkeyParser } from "./cashmonkey";
import { easypostApiParser } from "./easypost_api";
import { ebayParser } from "./ebay";
import { ebayApiParser } from "./ebay_api";
import { fedexParser } from "./fedex";
import { goodwillBooksParser } from "./goodwill_books";
import { jewelryParser } from "./jewelry";
import { shippingOsmPbEasypostParser } from "./shipping_osm_pb_easypost";
import { shopgoodwillParser } from "./shopgoodwill";
import type { RawTable, SourceParser } from "./types";
import { uprightParser } from "./upright";
import { uprightApiParser } from "./upright_api";
import { isJsonTable } from "./_shared/json";
import { bank1stSourceParser } from "./bank_1st_source";
import { marketplaceRatingsParser } from "./marketplace_ratings";
import { productionTrackingParser } from "./production_tracking";
import { timekeepingParser } from "./timekeeping";
import { uprightInventoryParser } from "./upright_inventory";

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
  // Ops sources (no revenue): item lifecycle, labor, ratings, bank statement.
  productionTrackingParser,
  uprightInventoryParser,
  timekeepingParser,
  marketplaceRatingsParser,
  bank1stSourceParser,
];

/** Parsers for JSON API responses (one response document per file). */
export const jsonParsers: SourceParser[] = [ebayApiParser, easypostApiParser, uprightApiParser, amazonApiParser];

/**
 * A source's file parser. For a source that also has a JSON API parser, the
 * returned parser hands JSON documents to the API parser and everything else
 * to the file parser, so `ingestFile({ sourceId: "ebay" })` works for both
 * (the run then records the file parser's version).
 */
export function getParser(sourceId: string): SourceParser | undefined {
  const file = parsers.find((p) => p.sourceId === sourceId);
  const json = jsonParsers.find((p) => p.sourceId === sourceId);
  if (!file || !json) return file ?? json;
  return {
    sourceId,
    version: file.version,
    accepts: (table, fileName) => (isJsonTable(table) ? json : file).accepts(table, fileName),
    parse: (table, ctx) => (isJsonTable(table) ? json : file).parse(table, ctx),
  };
}

/** Every parser registered for a source (file parser first, then JSON). */
export function getParsers(sourceId: string): SourceParser[] {
  return [...parsers, ...jsonParsers].filter((p) => p.sourceId === sourceId);
}

/**
 * First registered parser whose `accepts()` returns true. A parser that
 * throws inside `accepts()` is treated as "no". JSON documents only go to
 * the JSON parsers.
 */
export function detectParser(table: RawTable, fileName: string): SourceParser | undefined {
  const pool = isJsonTable(table) ? jsonParsers : parsers;
  return pool.find((p) => {
    try {
      return p.accepts(table, fileName);
    } catch {
      return false;
    }
  });
}
