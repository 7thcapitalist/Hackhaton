/**
 * Small pure helpers shared by every parser. No I/O.
 */
import type { RawTable } from "../types";

export const TIMEZONE = "America/Indiana/Indianapolis" as const;

/** Lowercase, trim, collapse spaces, strip quotes/BOM. */
export function normalizeHeader(cell: string): string {
  return cell
    .replace(/^﻿/, "")
    .replace(/["']/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Find the header row: the first row (within the first `maxScan` rows) whose
 * normalized cells contain every one of `required` (already normalized).
 * Returns -1 if not found. Handles preamble/disclaimer lines before the header.
 */
export function findHeaderRow(table: RawTable, required: string[], maxScan = 30): number {
  const limit = Math.min(table.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const cells = new Set(table[i].map(normalizeHeader));
    if (required.every((r) => cells.has(r))) return i;
  }
  return -1;
}

/**
 * Map header names to column indexes. Each key accepts several aliases, so a
 * renamed column still resolves (the first alias found wins).
 */
export function columnIndex<K extends string>(
  header: string[],
  aliases: Record<K, string[]>,
): Record<K, number> {
  const norm = header.map(normalizeHeader);
  const out = {} as Record<K, number>;
  for (const key of Object.keys(aliases) as K[]) {
    out[key] = aliases[key].map(normalizeHeader).map((a) => norm.indexOf(a)).find((i) => i >= 0) ?? -1;
  }
  return out;
}

/** True for blank lines and footer rows with fewer than `minCells` filled cells. */
export function isBlankRow(row: string[], minCells = 2): boolean {
  return row.filter((c) => c.trim() !== "").length < minCells;
}

/**
 * "$1,234.56", "(12.00)", "-12", "1.234,56"? (US only) → integer cents.
 * Returns null for empty or unparseable input.
 */
export function toCents(value: string | undefined | null): number | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (s === "" || s === "--" || s === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "").replace(/^USD/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

/**
 * Convert a UTC instant to the business date (YYYY-MM-DD) in Goodwill's time
 * zone, so an order at 11:30 PM Eastern lands on the right day.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Cached Intl.DateTimeFormat per (kind, zone). Building a formatter is slow;
 * parsing every fixture spent ~10 s just constructing them. Formatters are
 * immutable, so sharing them is safe.
 */
export function cachedFormatter(tz: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${withTime ? "t" : "d"}|${tz}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = withTime
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(key, f);
  }
  return f;
}

export function businessDateOf(utc: Date): string {
  const parts = cachedFormatter(TIMEZONE, false).formatToParts(utc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** YYYY-MM of a YYYY-MM-DD date. */
export function periodOf(businessDate: string): string {
  return businessDate.slice(0, 7);
}
