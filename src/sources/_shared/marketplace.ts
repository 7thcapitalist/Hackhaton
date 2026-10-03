/**
 * Helpers for the marketplace parsers (amazon, ebay, shopgoodwill, upright).
 * Pure, no I/O. Builds on ./table.ts without changing it.
 */
import type { ParsedOrder, ParseResult, RawTable } from "../types";
import { businessDateOf, cachedFormatter, normalizeHeader, periodOf, TIMEZONE, toCents } from "./table";

export type ChannelId = "shopgoodwill" | "amazon" | "ebay" | "goodwill_books" | "other";

/**
 * Find the header row by aliases: the first row (within `maxScan`) that has at
 * least one alias of every key in `requiredKeys`. Unlike findHeaderRow, a
 * renamed column (any listed alias) still matches. Returns -1 if not found.
 */
export function findHeaderRowByAliases<K extends string>(
  table: RawTable,
  aliases: Record<K, string[]>,
  requiredKeys: K[],
  maxScan = 30,
): number {
  const limit = Math.min(table.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const cells = new Set(table[i].map(normalizeHeader));
    if (requiredKeys.every((k) => aliases[k].some((a) => cells.has(normalizeHeader(a))))) return i;
  }
  return -1;
}

/** Cell at column `idx`, trimmed; "" when the column is missing. */
export function cell(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? (row[idx] ?? "").trim() : "";
}

/** toCents that treats empty/missing as 0. */
export function cents(row: string[], idx: number): number {
  return toCents(cell(row, idx)) ?? 0;
}

/** True if any of the first `maxScan` rows contains `pattern` in any cell. */
export function preambleMatches(table: RawTable, pattern: RegExp, maxScan = 15): boolean {
  return table.slice(0, maxScan).some((r) => r.some((c) => pattern.test(c)));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** US zone abbreviations seen in marketplace exports → offset in minutes from UTC. */
const ZONE_OFFSETS: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0,
  EST: -300, EDT: -240, CST: -360, CDT: -300,
  MST: -420, MDT: -360, PST: -480, PDT: -420,
};

/** Offset (minutes) of `tz` at instant `utcMs`. */
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = cachedFormatter(tz, true).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Wall-clock time in `tz` → UTC Date (DST-aware). */
export function zonedToUtc(
  y: number, mo: number, d: number, h = 0, mi = 0, s = 0, tz: string = TIMEZONE,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = tzOffsetMinutes(guess, tz);
  let ms = guess - off * 60000;
  const off2 = tzOffsetMinutes(ms, tz);
  if (off2 !== off) {
    off = off2;
    ms = guess - off * 60000;
  }
  return new Date(ms);
}

function to24h(h: number, ampm: string | undefined): number {
  if (!ampm) return h;
  const pm = ampm.toUpperCase() === "PM";
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/**
 * Parse the date formats our marketplace exports use. A value with an explicit
 * zone (Z, ±hh:mm, PDT, EST…) is honored; a value without one is read as
 * America/Indiana/Indianapolis wall-clock time. Returns null if unparseable.
 *
 * Handles:
 *  - ISO: 2026-09-30T23:45:00Z, 2026-09-30T23:45:00-04:00, 2026-09-30 23:45[:00]
 *  - Amazon: "Sep 30, 2026 8:45:12 PM PDT"
 *  - eBay: "Sep-30-26", "Sep-30-26 23:45:00", "Sep-30-26 23:45:00 PDT"
 *  - US: 9/30/2026, 09/30/2026 23:45, 9/30/26 11:45 PM
 */
export function parseDateTime(raw: string, defaultTz: string = TIMEZONE): Date | null {
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v) return null;

  // ISO with explicit zone → native parser.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(v)) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  let y: number, mo: number, d: number;
  let rest: string;
  let m: RegExpMatchArray | null;

  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3]; rest = m[4] ?? "";
  } else if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?: (.*))?$/))) {
    mo = +m[1]; d = +m[2]; y = fullYear(+m[3]); rest = m[4] ?? "";
  } else if ((m = v.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})(?: (.*))?$/))) {
    mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = +m[3]; rest = m[4] ?? "";
  } else if ((m = v.match(/^([A-Za-z]+)-(\d{1,2})-(\d{2,4})(?: (.*))?$/))) {
    mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = fullYear(+m[3]); rest = m[4] ?? "";
  } else {
    return null;
  }
  if (!mo || !d || !y || mo > 12 || d > 31) return null;

  let h = 0, mi = 0, s = 0;
  let zone: string | undefined;
  if (rest) {
    const t = rest.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?: ?([AaPp][Mm]))?(?: ?([A-Za-z]{1,4}|[+-]\d{2}:?\d{2}))?$/);
    if (!t) return null;
    h = to24h(+t[1], t[4]); mi = +t[2]; s = t[3] ? +t[3] : 0;
    zone = t[5];
    if (h > 23 || mi > 59 || s > 59) return null;
  }

  if (zone) {
    const z = zone.toUpperCase();
    let offMin: number | undefined = ZONE_OFFSETS[z];
    const om = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (om) offMin = (om[1] === "-" ? -1 : 1) * (+om[2] * 60 + +om[3]);
    if (offMin === undefined) return null;
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offMin * 60000);
  }
  return zonedToUtc(y, mo, d, h, mi, s, defaultTz);
}

/**
 * Report time zone from a file-name hint, else `fallback`. Hints: `_et` /
 * `_eastern` / `_indy` → Indianapolis, `_ct` / `_central` → Chicago, `_pt` /
 * `_pacific` → Los Angeles, or an explicit `_tz-America-Indiana-Indianapolis`.
 * For exports whose cells carry no zone (Upright, ShopGoodwill).
 */
export function zoneFromFileName(fileName: string, fallback: string): string {
  const name = fileName.toLowerCase();
  const tz = name.match(/tz[-_=]([a-z]+(?:-[a-z_]+)+)/);
  if (tz) {
    const iana = tz[1]
      .split("-")
      .map((p) => p.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_"))
      .join("/");
    try {
      cachedFormatter(iana, true);
      return iana;
    } catch {
      /* not a zone: fall through */
    }
  }
  const tag = (re: string) => new RegExp(`(^|[_\\-. ])(${re})([_\\-. ]|$)`).test(name);
  if (tag("et|eastern|indy|indianapolis")) return "America/Indiana/Indianapolis";
  if (tag("ct|central|chicago")) return "America/Chicago";
  if (tag("pt|pacific|la")) return "America/Los_Angeles";
  return fallback;
}

// ---------------------------------------------------------------------------
// Orders and result bookkeeping
// ---------------------------------------------------------------------------

export interface OrderAmounts {
  grossCents?: number;
  shippingCents?: number;
  refundCents?: number;
  feeCents?: number;
  taxCents?: number;
}

/** net = gross + shipping − refund − fee (tax excluded). Research §6.3. */
export function netOf(a: OrderAmounts): number {
  return (a.grossCents ?? 0) + (a.shippingCents ?? 0) - (a.refundCents ?? 0) - (a.feeCents ?? 0);
}

/** Recompute netCents after amounts change. */
export function refreshNet(o: ParsedOrder): void {
  o.netCents = netOf(o);
}

/** UTC Date → { orderTs ISO, businessDate }. */
export function stamp(utc: Date): { orderTs: string; businessDate: string } {
  return { orderTs: utc.toISOString(), businessDate: businessDateOf(utc) };
}

/** Most common value, or undefined for an empty list. */
function mode(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

/**
 * Fill result.period (ctx.period wins, else the most common order/money-line
 * period) and result.businessDate (only when every order is on one day and
 * the file name carries that YYYY-MM-DD, i.e. a daily file).
 */
export function finishResult(result: ParseResult, fileName: string, ctxPeriod?: string): ParseResult {
  const dates = result.orders.map((o) => o.businessDate);
  const periods = [...dates.map(periodOf), ...result.moneyLines.map((m) => m.period)];
  result.period = ctxPeriod ?? mode(periods);
  const day = fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  const uniq = new Set(dates);
  if (day && uniq.size === 1 && uniq.has(day)) result.businessDate = day;
  if (ctxPeriod && periods.some((p) => p !== ctxPeriod)) {
    result.warnings.push({
      message: `Some rows fall outside the chosen period ${ctxPeriod} (found ${[...new Set(periods)].join(", ")}).`,
    });
  }
  return result;
}

/** Empty result for a file whose header could not be found. */
export function headerNotFound(what: string): ParseResult {
  return {
    orders: [],
    moneyLines: [],
    warnings: [{ message: `Header row not found: expected a ${what} export.` }],
    headerRowIndex: -1,
    header: [],
  };
}

/** Warn once per missing optional/required column key. */
export function warnMissingColumns<K extends string>(
  result: ParseResult,
  cols: Record<K, number>,
  keys: K[],
): void {
  const missing = keys.filter((k) => cols[k] < 0);
  if (missing.length) result.warnings.push({ message: `Columns not found: ${missing.join(", ")}.` });
}
