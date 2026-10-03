/**
 * Date helpers shared by the view functions, the route handlers and the seed.
 * business_date is `YYYY-MM-DD` in America/Indiana/Indianapolis; period is `YYYY-MM`.
 * Pure functions, no DB access.
 */
export const BUSINESS_TZ = "America/Indiana/Indianapolis" as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_RE = /^(\d{4})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s;
}

/** True for `YYYY-MM` with month 01..12. */
export function isValidPeriod(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = PERIOD_RE.exec(s);
  return !!m && +m[2]! >= 1 && +m[2]! <= 12;
}

/** Adds `n` calendar days to a `YYYY-MM-DD` date. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole days between two dates (`to - from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** First and last calendar day of a period. */
export function periodBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const start = `${period}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

/** The month before `period`. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

const businessDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Business date (Indianapolis) of a UTC instant. */
export function businessDateOf(utc: Date | string): string {
  const d = typeof utc === "string" ? new Date(utc) : utc;
  return businessDateFmt.format(d); // en-CA formats as YYYY-MM-DD
}

const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  timeZoneName: "longOffset",
});

/** UTC offset of the business time zone at a given instant, in minutes (e.g. -240 for EDT). */
export function businessTzOffsetMinutes(at: Date): number {
  const part = offsetFmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!m) return 0;
  const mins = +m[2]! * 60 + +m[3]!;
  return m[1] === "-" ? -mins : mins;
}

/** Converts a local wall-clock time in the business TZ to a UTC instant. */
export function localToUtc(date: string, secondsOfDay: number): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) + secondsOfDay * 1000;
  const offset = businessTzOffsetMinutes(new Date(naive));
  return new Date(naive - offset * 60_000);
}
