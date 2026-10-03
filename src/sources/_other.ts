/**
 * Helpers used by the "other" parsers (cashmonkey, jewelry, shipping, fedex,
 * goodwill_books). Pure, no I/O. Candidates to move into _shared/ later.
 */
import type { RawTable } from "./types";
import { businessDateOf, findHeaderRow, normalizeHeader, TIMEZONE } from "./_shared/table";

/** A cell by column index, trimmed; "" when the column is missing. */
export function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Try several required-column sets (each one alias combination) and return the
 * first header row found, or -1. Lets a parser accept renamed headers.
 */
export function findHeaderRowAny(table: RawTable, requiredSets: string[][], maxScan = 30): number {
  let best = -1;
  for (const req of requiredSets) {
    const i = findHeaderRow(table, req.map(normalizeHeader), maxScan);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/** True if any cell in the first `maxScan` rows matches `re`. */
export function preambleMatches(table: RawTable, re: RegExp, maxScan = 15): boolean {
  const limit = Math.min(table.length, maxScan);
  for (let i = 0; i < limit; i++) {
    if (table[i].some((c) => re.test(c))) return true;
  }
  return false;
}

/** Normalized header cells of a row, as a Set (for distinctive-column checks). */
export function headerSet(row: string[] | undefined): Set<string> {
  return new Set((row ?? []).map(normalizeHeader));
}

/** Offset (minutes) of `TIMEZONE` from UTC at the given instant. */
function tzOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Wall-clock time in Goodwill's time zone → UTC Date. */
function localToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMinutes(guess);
  const off2 = tzOffsetMinutes(guess - off1 * 60000);
  return new Date(guess - off2 * 60000);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export interface ParsedDate {
  /** ISO-8601 UTC instant. Date-only inputs use local noon. */
  ts: string;
  /** YYYY-MM-DD in America/Indiana/Indianapolis. */
  businessDate: string;
}

/**
 * Parse the date formats these exports use:
 * - ISO with zone ("2026-09-03T14:22:01Z", "+00:00", " UTC"): an instant.
 * - ISO without zone, "MM/DD/YYYY [h:mm[:ss] [AM|PM]]", "Sep 3, 2026", "20260903":
 *   wall-clock time in Goodwill's time zone (date-only → local noon).
 * Returns null when unparseable.
 */
export function parseDate(value: string | undefined | null): ParsedDate | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "") return null;

  // ISO with explicit zone → real instant.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s.replace(" ", "T").replace(/\s*UTC$/i, "Z"));
    if (!isNaN(d.getTime())) return { ts: d.toISOString(), businessDate: businessDateOf(d) };
  }

  let y = 0, mo = 0, d = 0, h = 12, mi = 0, sec = 0;
  let rest = "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4] ?? "";
  } else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(.*))?$/))) {
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
    rest = m[4] ?? "";
  } else if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(.*))?$/))) {
    mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()] ?? 0;
    [d, y] = [Number(m[2]), Number(m[3])];
    rest = m[4] ?? "";
  } else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return null;
  }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000)) return null;

  if (rest) {
    const t = rest.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?/i);
    if (!t) return null;
    h = Number(t[1]);
    mi = Number(t[2]);
    sec = Number(t[3] ?? 0);
    const ampm = t[4]?.toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
  }
  const utc = localToUtc(y, mo, d, h, mi, sec);
  if (isNaN(utc.getTime())) return null;
  return { ts: utc.toISOString(), businessDate: businessDateOf(utc) };
}

/** Most common YYYY-MM among the given dates, or undefined. */
export function dominantPeriod(dates: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [p, c] of counts) if (c > n) [best, n] = [p, c];
  return best;
}

/** Footer/total rows ("Total", "Grand Total", "Totals:", "Net Payment" …). */
export function isTotalRow(row: string[]): boolean {
  return row.some((c) => /^(grand\s+)?totals?\b|^sub-?total\b/i.test(c.trim()));
}

/** Integer from "3", "3.0", "" → fallback. */
export function toInt(value: string, fallback = 1): number {
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) && String(value).trim() !== "" ? Math.round(n) : fallback;
}

/**
 * Period for the result: the file's own period wins; if the user picked a
 * different one on upload, add a warning. Falls back to the user's choice.
 */
export function choosePeriod(
  result: { warnings: { row?: number; message: string }[] },
  filePeriod: string | undefined,
  ctxPeriod: string | undefined,
): string | undefined {
  if (filePeriod && ctxPeriod && filePeriod !== ctxPeriod) {
    result.warnings.push({ message: `File covers ${filePeriod} but upload was tagged ${ctxPeriod}.` });
  }
  return filePeriod ?? ctxPeriod;
}
