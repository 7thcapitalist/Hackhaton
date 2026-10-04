// Pure calendar helpers on plain YYYY-MM-DD / YYYY-MM strings (UTC math, so no timezone drift).

const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (t: Date) => t.toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => iso(new Date(parse(d).getTime() + n * 864e5));
export const monthOf = (d: string) => d.slice(0, 7);
export const weekday = (d: string) => parse(d).getUTCDay(); // 0 = Sunday

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Same day of the month n months later, clamped to that month's length (Mar 31 − 1 month = Feb 28). */
export function addMonthsToDate(d: string, n: number): string {
  const month = addMonths(monthOf(d), n);
  const day = Math.min(Number(d.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

export const clamp = (d: string, min: string, max: string) => (d < min ? min : d > max ? max : d);

/**
 * The month's weeks, Sunday first. Only weeks that contain days of the month: leading and
 * trailing days from the neighboring months only fill the first and last week.
 */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const start = addDays(first, -weekday(first));
  const end = addDays(last, 6 - weekday(last));
  const weeks: string[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

/** Where a grid key moves focus: arrows by day/week, PageUp/PageDown by month, Home/End to the week's ends. */
export function moveByKey(d: string, key: string): string | null {
  switch (key) {
    case "ArrowLeft": return addDays(d, -1);
    case "ArrowRight": return addDays(d, 1);
    case "ArrowUp": return addDays(d, -7);
    case "ArrowDown": return addDays(d, 7);
    case "PageUp": return addMonthsToDate(d, -1);
    case "PageDown": return addMonthsToDate(d, 1);
    case "Home": return addDays(d, -weekday(d));
    case "End": return addDays(d, 6 - weekday(d));
    default: return null;
  }
}

/** Month grid keys: arrows by one month / one row of 3, Home/End to the row's ends. */
export function moveMonthByKey(month: string, key: string): string | null {
  const col = (Number(month.slice(5, 7)) - 1) % 3;
  switch (key) {
    case "ArrowLeft": return addMonths(month, -1);
    case "ArrowRight": return addMonths(month, 1);
    case "ArrowUp": return addMonths(month, -3);
    case "ArrowDown": return addMonths(month, 3);
    case "Home": return addMonths(month, -col);
    case "End": return addMonths(month, 2 - col);
    default: return null;
  }
}

export const formatDayLabel = (d: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parse(d));
export const formatMonthLabel = (month: string, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(parse(`${month}-01`));
