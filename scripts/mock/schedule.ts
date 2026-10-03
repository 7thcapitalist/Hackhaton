/**
 * When each file would reach Goodwill (upload time) and which days/months get
 * files. The seed ingests files in upload order, like real life.
 */
import { addDays, dateRange } from "../../src/lib/views/dates";
import { END_DATE, MONTHLY_FILE_PERIODS, PY_PERIODS, SEED_NOW, START_DATE } from "./model";

export const ALL_DATES = dateRange(START_DATE, END_DATE);

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

/** Months with month-end files (prior year + closed months). */
export const MONTHLY_PERIODS: readonly string[] = MONTHLY_FILE_PERIODS;
/** Prior-year months: the nightly sources deliver one monthly file each. */
export const PRIOR_YEAR_PERIODS: readonly string[] = PY_PERIODS;

export function datesOf(period: string): string[] {
  return ALL_DATES.filter((d) => d.startsWith(period));
}

export function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
