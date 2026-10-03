import { BUSINESS_TZ, isValidDate, businessDateOf, addDays } from "@/lib/views/dates";

export const GOODWILL_TIMEZONE = BUSINESS_TZ;
export const isBusinessDate = isValidDate;

// Reuse the shared calendar/timezone rules, including DST transitions.
export function previousBusinessDate(now: Date): string {
  return addDays(businessDateOf(now), -1);
}
