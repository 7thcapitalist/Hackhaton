export const GOODWILL_TIMEZONE = "America/Indiana/Indianapolis";

export function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Calendar subtraction after finding the local date also works across DST changes. */
export function previousBusinessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GOODWILL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)!.value;
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  const previous = new Date(`${localDate}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}
