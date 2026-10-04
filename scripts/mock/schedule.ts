/**
 * When each file would reach Goodwill (upload time) and which days/weeks/months
 * get files. The seed ingests files in upload order, like real life.
 *
 * Cadence (src/ingest/config.ts SOURCE_CADENCE): every source is pulled at the
 * highest frequency its real system supports. In the current-year range
 * (START_DATE..END_DATE) daily sources get one file per business day, OSM one
 * per weekly invoice, Goodwill Books one per closed month. The prior year
 * (2025-08..10) stays one monthly file per source, for speed: it only feeds
 * year-over-year growth.
 */
import { addDays, dateRange } from "../../src/lib/views/dates";
import { CLOSED_PERIODS, END_DATE, MONTHLY_FILE_PERIODS, PY_PERIODS, SEED_NOW, START_DATE } from "./model";

export const ALL_DATES = dateRange(START_DATE, END_DATE);
/**
 * Days whose file is out by SEED_NOW for sources that only deliver a finished
 * day (bank statement, Cash Monkey, timecards, FedEx invoice…): every day
 * before today. Marketplace feeds also deliver today's partial file.
 */
export const DONE_DATES = ALL_DATES.filter((d) => d < END_DATE);

/**
 * Nightly files land the next morning around 6:30 AM Eastern (10:30 UTC).
 * Upright's emailed report arrives later (offset 30), so it supersedes the
 * marketplace rows it also lists. Today's files arrive before SEED_NOW.
 */
export function dailyUpload(date: string, offsetMin: number): string {
  if (date === END_DATE) {
    const t = new Date(SEED_NOW).getTime() - (40 - offsetMin) * 60_000;
    return new Date(t).toISOString();
  }
  const base = Date.parse(`${addDays(date, 1)}T10:30:00.000Z`);
  return new Date(base + offsetMin * 60_000).toISOString();
}

/** Month-end files arrive on the 3rd of the next month, 10 AM Eastern. */
export function monthlyUpload(period: string, offsetMin: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const base = Date.UTC(y, m, 3, 14, 0, 0); // month m (1-based) = next month (0-based)
  return new Date(base + offsetMin * 60_000).toISOString();
}

/** Months with month-end files (prior year + closed months): monthly-only sources. */
export const MONTHLY_PERIODS: readonly string[] = MONTHLY_FILE_PERIODS;
/** Prior-year months: every source delivers one monthly file each (no daily history kept, for speed). */
export const PRIOR_YEAR_PERIODS: readonly string[] = PY_PERIODS;
/** Closed current-year months. */
export const CLOSED_MONTHS: readonly string[] = CLOSED_PERIODS;

/** Monday of the week of `date` (Mon..Sun weeks). */
export function mondayOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

/**
 * Weekly invoice weeks (Mon..Sun) of the current-year range whose invoice is
 * already out: the week ended before END_DATE (invoiced the next Monday). The
 * running week's invoice is not due yet.
 */
export const DONE_WEEKS: readonly string[] = (() => {
  const out: string[] = [];
  for (let mon = mondayOf(START_DATE); addDays(mon, 6) < END_DATE; mon = addDays(mon, 7)) out.push(mon);
  return out;
})();

/** Weekly invoice upload: the Monday after the week, 10 AM Eastern. */
export function weeklyUpload(monday: string, offsetMin: number): string {
  const base = Date.parse(`${addDays(monday, 7)}T14:00:00.000Z`);
  return new Date(base + offsetMin * 60_000).toISOString();
}

export function datesOf(period: string): string[] {
  return ALL_DATES.filter((d) => d.startsWith(period));
}

export function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
