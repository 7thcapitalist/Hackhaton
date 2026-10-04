/**
 * Parser contract (docs/data-contract.md "Parser interface").
 *
 * Parsers are pure: they turn one export file into rows, with no DB access.
 * The ingest service (src/ingest/) assigns ids, the ingest_run_id and the
 * source_id, hashes buyer ids into buyer_key, and writes everything.
 *
 * Money is integer cents, + = money in. Dates: order_ts is ISO-8601 UTC,
 * business_date is YYYY-MM-DD in America/Indiana/Indianapolis.
 */
import type { NewItem, NewLaborHour, NewMarketplaceMetric, NewMoneyLine, NewOrder } from "@/db/schema";

/** An order line as a parser emits it. */
export type ParsedOrder = Omit<
  NewOrder,
  "id" | "sourceId" | "ingestRunId" | "buyerKey" | "dedupeKey"
> & {
  /** Raw marketplace buyer id. Ingest hashes it; it is never stored. */
  buyerId?: string | null;
};

export type ParsedMoneyLine = Omit<NewMoneyLine, "id" | "sourceId" | "ingestRunId">;

/**
 * An item lifecycle row. `id` is the item's own id (SKU / production tag) when
 * the source has one: ingest then MERGES rows with the same id, because two
 * sources fill different timestamps of the same item (production tracking:
 * donated/identified/sent; Upright inventory: listed/sold/price/relists).
 * Without an id, ingest inserts a new row.
 */
export type ParsedItem = Omit<NewItem, "id" | "ingestRunId"> & { id?: string };

/** Hours one pseudonymous employee worked on one day (e-commerce departments only). */
export type ParsedLaborHour = Omit<NewLaborHour, "id" | "ingestRunId">;

/** One monthly marketplace health metric for one channel (CSAT, NPS, conversion, seller rating). */
export type ParsedMarketplaceMetric = Omit<NewMarketplaceMetric, "id" | "ingestRunId">;

export interface ParseWarning {
  /** 1-based row number in the original file, if the warning is about a row. */
  row?: number;
  message: string;
}

export interface ParseResult {
  orders: ParsedOrder[];
  moneyLines: ParsedMoneyLine[];
  items?: ParsedItem[];
  laborHours?: ParsedLaborHour[];
  marketplaceMetrics?: ParsedMarketplaceMetric[];
  warnings: ParseWarning[];
  /** 0-based index of the header row found in the file. */
  headerRowIndex: number;
  /** Normalized header, as found (lowercased, trimmed). */
  header: string[];
  /** Period the file covers (YYYY-MM), if the parser can tell. */
  period?: string;
  /** Business date the file covers (YYYY-MM-DD), for daily files. */
  businessDate?: string;
  /** e.g. ShopGoodwill "Period 1" / "Period 3". */
  periodLabel?: string;
  /**
   * Supplier assignments for orders that may already be in the DB (slide 40
   * step 03 "Enrich"). Ingest sets orders.supplier on the order with that
   * dedupe_key, whichever source loaded it. Additive: a parsed order that
   * carries `supplier` and is dropped as a duplicate enriches the kept order
   * the same way, so most parsers never need this list.
   */
  enrichments?: ParsedEnrichment[];
}

/** Set orders.supplier on the order with this dedupe_key (`channel:order:item`). */
export interface ParsedEnrichment {
  dedupeKey: string;
  supplier: string;
}

export interface ParseContext {
  fileName: string;
  /** Period chosen by the user on upload, if any (YYYY-MM). */
  period?: string;
  timezone: "America/Indiana/Indianapolis";
}

/**
 * The file as a table: every row of the first sheet (CSV or XLSX) as
 * trimmed strings, INCLUDING preamble lines, blank lines and footers.
 * Finding the real header row is the parser's job (see findHeaderRow).
 */
export type RawTable = string[][];

export interface SourceParser {
  sourceId: string;
  /** Bumped when parsing logic changes; stored on ingest_runs.parser_version. */
  version: string;
  /** Auto-detect: does this table look like this source's export? */
  accepts(table: RawTable, fileName: string): boolean;
  parse(table: RawTable, ctx: ParseContext): ParseResult;
}

// ---------------------------------------------------------------------------
// JSON inputs (API connectors). ADDITIVE: every CSV/XLSX parser above and the
// ingest service keep working unchanged.
//
// Some platform APIs return JSON instead of a report file (eBay Sell
// Fulfillment getOrders, eBay Finances, EasyPost Shipments). To keep ONE ingest
// path, src/ingest/read.ts turns a .json file into a one-row RawTable:
//   [[JSON_TABLE_MARKER, "<the raw JSON text>"]]
// No CSV parser accepts that row (no known header), and the JSON parsers
// (src/sources/ebay_api.ts, easypost_api.ts) accept only it. Helpers live in
// src/sources/_shared/json.ts.
// ---------------------------------------------------------------------------

/** First cell of the single row that carries a JSON document as a RawTable. */
export const JSON_TABLE_MARKER = "__json_document__";

/** What a parser can receive: a table (CSV/XLSX) or a JSON document (API). */
export type RawInput = { kind: "table"; table: RawTable } | { kind: "json"; json: unknown };

/**
 * A parser for JSON API responses. Wrap it with `jsonSourceParser()` from
 * src/sources/_shared/json.ts to get a plain SourceParser for the registry.
 */
export interface JsonSourceParser {
  /** Same source id as the file parser for that platform, so dedupe and views treat both as one source. */
  sourceId: string;
  version: string;
  acceptsJson(json: unknown, fileName: string): boolean;
  parseJson(json: unknown, ctx: ParseContext): ParseResult;
}
