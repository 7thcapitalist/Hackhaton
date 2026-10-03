/**
 * Formatting helpers for the mock writers: CSV rows, money and the date
 * layouts each platform uses. Pure, deterministic (no Date.now, no locale
 * defaults).
 */

export type Cell = string | number | null | undefined;

/** RFC 4180 field: quoted only when needed (or when `force`). */
export function csvField(v: Cell, force = false): string {
  const s = v == null ? "" : String(v);
  if (force || /[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One CSV line. `quoteCols` = column indexes that are always quoted. */
export function csvRow(cells: Cell[], quoteCols: ReadonlySet<number> = new Set()): string {
  return cells.map((c, i) => csvField(c, quoteCols.has(i))).join(",");
}

/** Join lines with the platform's line ending, ending with one. */
export function lines(rows: string[], eol: "\n" | "\r\n"): string {
  return rows.join(eol) + eol;
}

/** 1234 → "12.34"; -1234 → "-12.34". */
export function dec(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** 123456 → "1,234.56" (no sign handling). */
function grouped(a: number): string {
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${String(a % 100).padStart(2, "0")}`;
}

/** 1234 → "$12.34"; -1234 → "-$12.34". */
export function usd(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${grouped(Math.abs(cents))}`;
}

/** Accounting style: -1234 → "($12.34)". */
export function usdParens(cents: number): string {
  return cents < 0 ? `($${grouped(-cents)})` : `$${grouped(cents)}`;
}

// ---------------------------------------------------------------------------
// Dates. All inputs are UTC instants; outputs are wall-clock in a zone.
// ---------------------------------------------------------------------------

export const INDY = "America/Indiana/Indianapolis";
export const PACIFIC = "America/Los_Angeles";

export interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function wall(utc: Date, tz: string): Wall {
  const parts = fmt(tz).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const p2 = (n: number) => String(n).padStart(2, "0");
const h12 = (h: number) => ({ h: h % 12 === 0 ? 12 : h % 12, ap: h < 12 ? "AM" : "PM" });

export function monthName(period: string): string {
  return MONTH_NAMES[Number(period.slice(5, 7)) - 1]!;
}

/** Amazon: "Sep 30, 2026 8:45:12 PM PDT" (Pacific time, zone abbreviation). */
export function amazonDate(utc: Date): string {
  const w = wall(utc, PACIFIC);
  const off = Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - utc.getTime()) / 60000);
  const zone = off === -420 ? "PDT" : "PST";
  const { h, ap } = h12(w.h);
  return `${MON[w.mo - 1]} ${w.d}, ${w.y} ${h}:${p2(w.mi)}:${p2(w.s)} ${ap} ${zone}`;
}

/** eBay: "Sep-30-26 23:45:00" (local, no zone). */
export function ebayDateTime(utc: Date): string {
  const w = wall(utc, INDY);
  return `${MON[w.mo - 1]}-${p2(w.d)}-${p2(w.y % 100)} ${p2(w.h)}:${p2(w.mi)}:${p2(w.s)}`;
}

/** eBay footer date: "Sep-30-26". */
export function ebayDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${MON[m - 1]}-${p2(d)}-${p2(y % 100)}`;
}
/** ShopGoodwill: "09/30/2026 08:45 PM" (wall clock in `tz`; the portal uses Pacific). */
export function sgwDate(utc: Date, tz: string = INDY): string {
  const w = wall(utc, tz);
  const { h, ap } = h12(w.h);
  return `${p2(w.mo)}/${p2(w.d)}/${w.y} ${p2(h)}:${p2(w.mi)} ${ap}`;
}

/** Upright: "9/30/2026 11:45:00 PM" (wall clock in the zone picked when generating). */
export function uprightDate(utc: Date, tz: string = INDY): string {
  const w = wall(utc, tz);
  const { h, ap } = h12(w.h);
  return `${w.mo}/${w.d}/${w.y} ${h}:${p2(w.mi)}:${p2(w.s)} ${ap}`;
}

/** "09/30/2026" from YYYY-MM-DD. */
export function usDay(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
}

/** "09/30/2026 11:45 PM" (local) for late Cash Monkey rows. */
export function usDayTime(utc: Date): string {
  return sgwDate(utc);
}

/** EasyPost: "2026-09-01T14:02:11Z" (UTC ISO, no millis). */
export function isoUtc(utc: Date): string {
  return utc.toISOString().replace(/\.\d{3}Z$/, "Z");
}
