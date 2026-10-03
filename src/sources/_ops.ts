/**
 * Small helpers shared by the ops parsers (production_tracking,
 * upright_inventory, timekeeping, marketplace_ratings, bank_1st_source).
 * Pure, no I/O.
 */
import type { ParseResult, RawTable } from "./types";
import { columnIndex, findHeaderRow, normalizeHeader } from "./_shared/table";
import { parseDateTime } from "./_shared/marketplace";

/** First row (in the first 30) that has every column of one of the sets. */
export function headerRowOf(table: RawTable, requiredSets: string[][]): number {
  for (const set of requiredSets) {
    const i = findHeaderRow(table, set.map(normalizeHeader));
    if (i >= 0) return i;
  }
  return -1;
}

export function emptyResult(headerRowIndex: number, table: RawTable): ParseResult {
  return {
    orders: [],
    moneyLines: [],
    warnings: [],
    headerRowIndex,
    header: headerRowIndex >= 0 ? table[headerRowIndex].map(normalizeHeader) : [],
  };
}

export function columns<K extends string>(table: RawTable, h: number, aliases: Record<K, string[]>) {
  return columnIndex(table[h], aliases);
}

export const cellAt = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? "").trim() : "");

/** Local (Indianapolis) or zoned date-time → ISO UTC, or null. */
export function isoOf(raw: string): string | null {
  if (!raw) return null;
  const d = parseDateTime(raw);
  return d ? d.toISOString() : null;
}

/** "09/30/2026" or "2026-09-30" → "2026-09-30" (calendar date, no time zone shift). */
export function dayOf(raw: string): string | null {
  const v = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(v);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** YYYY-MM in the file name, if any. */
export function periodFromName(fileName: string): string | undefined {
  return /(\d{4}-\d{2})(?!-?\d)/.exec(fileName)?.[1];
}

export function num(raw: string): number | null {
  const v = raw.replace(/[,%$\s]/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Marketplace label → channels.id. */
export function channelOf(label: string): "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other" {
  const v = label.toLowerCase().replace(/[^a-z]/g, "");
  if (v.includes("shopgoodwill")) return "shopgoodwill";
  if (v.includes("amazon")) return "amazon";
  if (v.includes("ebay")) return "ebay";
  if (v.includes("goodwillbooks")) return "goodwill_books";
  return "other";
}
