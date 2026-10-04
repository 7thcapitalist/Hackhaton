// Month-to-date pace against the monthly revenue target. Pure: no I/O.

/** Behind the straight-line pace by less than this share of it counts as "near", like the Monthly report. */
export const PACE_NEAR_BAND = 0.05;

export type PaceInput = { daily: number[]; daysInMonth: number; targetCents: number | null };

export type Pace = {
  elapsedDays: number;          // complete days counted
  mtdCents: number;             // revenue so far
  expectedCents: number | null; // straight-line share of the target by now
  pctOfTarget: number | null;   // mtd / target × 100
  projectedCents: number;       // month end if the rest of the month averages like the days so far
  gapCents: number | null;      // mtd − expected (positive = ahead of pace)
  status: "ahead" | "near" | "behind" | "none";
};

/**
 * Straight-line pace: by day d of an N-day month we "should" have d/N of the target. Simple on
 * purpose, so it reads at a glance; it ignores weekday seasonality, so early-month calls are rough.
 */
export function computePace({ daily, daysInMonth, targetCents }: PaceInput): Pace {
  const elapsedDays = daily.length;
  const mtdCents = daily.reduce((a, v) => a + v, 0);
  const projectedCents = elapsedDays ? Math.round((mtdCents / elapsedDays) * daysInMonth) : 0;
  if (!targetCents || elapsedDays === 0) {
    return { elapsedDays, mtdCents, expectedCents: null, pctOfTarget: targetCents ? 0 : null, projectedCents, gapCents: null, status: "none" };
  }
  const expectedCents = Math.round((targetCents * elapsedDays) / daysInMonth);
  const gapCents = mtdCents - expectedCents;
  return {
    elapsedDays, mtdCents, expectedCents, projectedCents, gapCents,
    pctOfTarget: (mtdCents / targetCents) * 100,
    status: gapCents >= 0 ? "ahead" : mtdCents >= expectedCents * (1 - PACE_NEAR_BAND) ? "near" : "behind",
  };
}

/** Running total, day by day. */
export const cumulative = (daily: number[]) => daily.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);
