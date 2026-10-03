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
import type { NewItem, NewMoneyLine, NewOrder } from "@/db/schema";

/** An order line as a parser emits it. */
export type ParsedOrder = Omit<
  NewOrder,
  "id" | "sourceId" | "ingestRunId" | "buyerKey" | "dedupeKey"
> & {
  /** Raw marketplace buyer id. Ingest hashes it; it is never stored. */
  buyerId?: string | null;
};

export type ParsedMoneyLine = Omit<NewMoneyLine, "id" | "sourceId" | "ingestRunId">;

export type ParsedItem = Omit<NewItem, "id" | "ingestRunId">;

export interface ParseWarning {
  /** 1-based row number in the original file, if the warning is about a row. */
  row?: number;
  message: string;
}

export interface ParseResult {
  orders: ParsedOrder[];
  moneyLines: ParsedMoneyLine[];
  items?: ParsedItem[];
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
