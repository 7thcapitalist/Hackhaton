/**
 * File reading: bytes + file name → RawTable (src/sources/types.ts).
 *
 * Every row of the first sheet comes back as trimmed strings, including
 * preamble, blank and footer rows (finding the header is the parser's job).
 * Rows are padded to the same width; trailing fully-blank rows are dropped.
 */
import Papa from "papaparse";
import type { RawTable } from "@/sources/types";
import { jsonTable } from "@/sources/_shared/json";
import { IngestError } from "./errors";

/**
 * .json = one API response document (eBay REST, EasyPost). It comes back as
 * the one-row JSON table described in src/sources/types.ts, which only the
 * JSON API parsers accept.
 */
export const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".json"] as const;

export function extensionOf(fileName: string): string {
  const m = /\.[^./\\]+$/.exec(fileName.trim());
  return m ? m[0].toLowerCase() : "";
}

export async function readTable(buffer: Uint8Array, fileName: string): Promise<RawTable> {
  const ext = extensionOf(fileName);
  if (ext === ".json") return readJson(buffer, fileName);
  let rows: string[][];
  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
    rows = readDelimited(buffer, ext);
  } else if (ext === ".xlsx") {
    rows = await readXlsx(buffer);
  } else {
    const hint = ext === ".xls" ? " Save it as .xlsx or .csv first." : "";
    throw new IngestError(
      "unsupported_file",
      `Unsupported file type "${ext || "(none)"}" for ${fileName}. Upload .csv or .xlsx.${hint}`,
    );
  }
  return tidy(rows);
}

function readJson(buffer: Uint8Array, fileName: string): RawTable {
  const text = decodeText(buffer).trim();
  try {
    JSON.parse(text);
  } catch (err) {
    throw new IngestError(
      "unreadable_file",
      `Could not read JSON ${fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return jsonTable(text);
}

function decodeText(buffer: Uint8Array): string {
  // UTF-16 LE/BE BOMs (some Excel "Unicode text" exports), else UTF-8.
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  return new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
}

function readDelimited(buffer: Uint8Array, ext: string): string[][] {
  const text = decodeText(buffer);
  const result = Papa.parse<string[]>(text, {
    delimiter: ext === ".tsv" ? "\t" : ext === ".txt" ? "" : ",", // "" = auto-detect
    // newline omitted = auto-detect (\n, \r\n, \r)
    skipEmptyLines: false,
    header: false,
  });
  // Papa reports ragged rows as errors (preamble lines are short): not fatal.
  const fatal = result.errors.filter((e) => e.type === "Quotes" && e.code === "MissingQuotes");
  if (fatal.length > 0 && result.data.length === 0) {
    throw new IngestError("unreadable_file", `Could not read CSV: ${fatal[0].message}`);
  }
  return result.data;
}

async function readXlsx(buffer: Uint8Array): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs' types predate Buffer<ArrayBufferLike>; it accepts any Buffer.
    await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch (err) {
    throw new IngestError(
      "unreadable_file",
      `Could not read XLSX: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  const width = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const out: string[] = [];
    for (let c = 1; c <= width; c++) out.push(cellToString(row.getCell(c).value));
    rows.push(out);
  }
  return rows;
}

function dateToString(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  // exceljs reads Excel serial dates as UTC; date-only cells have no time part.
  const iso = d.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/** exceljs CellValue → string. Dates → ISO; formulas → their cached result. */
export function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return dateToString(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    }
    if ("result" in o || "formula" in o || "sharedFormula" in o) return cellToString(o.result);
    if ("text" in o) return cellToString(o.text); // hyperlink
    if ("error" in o) return "";
  }
  return String(v);
}

/** Trim cells, pad rows to equal width, drop trailing blank rows. */
function tidy(rows: unknown[][]): RawTable {
  const table = rows.map((row) => row.map((c) => (c == null ? "" : String(c)).trim()));
  while (table.length > 0 && table[table.length - 1].every((c) => c === "")) table.pop();
  const width = table.reduce((w, r) => Math.max(w, r.length), 0);
  for (const row of table) while (row.length < width) row.push("");
  return table;
}
