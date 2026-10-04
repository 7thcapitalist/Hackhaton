// Server-only: the data behind the charts inside the Monthly report's pillar sections.
// Built from existing view functions and KPI definitions; no new formulas, no direct SQL.
// Never import from a client component.
import { cache } from "react";
import { KPI_DEFINITIONS } from "@/kpis";
import { getPulseSeries } from "@/lib/views";
import { dateRange, periodBounds } from "@/lib/views/dates";
import type { DataRange } from "./data";
import { getPeriodFacts, getScorecardView, periodShort } from "./data";
import type { Kpi } from "./types";

/** Same month one year earlier ("2026-09" → "2025-09"). */
export const priorYearPeriod = (period: string) => `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;

const periodYearLabel = (period: string) => `${periodShort(period)} ${period.slice(0, 4)}`;

// ---- Financial: month-to-date revenue vs the same month last year and the target pace ----

export type PaceSeries = {
  period: string;
  label: string;                  // "Sep 2026"
  /** Cumulative net revenue (cents) at the end of each day of the month; null = no day data (not drawn, never zero-filled). */
  cumulative: (number | null)[];
  /** Days (1-based) where at least one marketplace had no file: the running total is understated from there. */
  gaps: { day: number; missing: string[] }[];
  /** First day (1-based) whose files arrived before the day ended; null when every day is complete. */
  partialFromDay: number | null;
  lastDay: number;                // last day (1-based) with data; 0 = none
};

export type RevenuePace = {
  days: number;                   // days in the selected month
  targetCents: number | null;     // monthly Total E-Commerce Revenue target
  current: PaceSeries;
  lastYear: PaceSeries | null;    // null when that month has no orders on record
};

async function paceSeries(period: string, through: string, completeDate: string): Promise<PaceSeries | null> {
  const { start, end } = periodBounds(period);
  const last = [end, through].sort()[0];
  if (last < start) return null;
  const s = await getPulseSeries(start, last);
  const all = dateRange(start, end);
  let run = 0, lastDay = 0, partialFromDay: number | null = null;
  const gaps: PaceSeries["gaps"] = [];
  const cumulative = all.map((d, i) => {
    const k = s.dates.indexOf(d);
    if (k < 0) return null;
    const missing = s.series.filter(x => x.revenueCents[k] == null);
    if (missing.length === s.series.length) return null; // no file for any marketplace that day
    if (missing.length) gaps.push({ day: i + 1, missing: missing.map(x => x.label) });
    if (d > completeDate && partialFromDay == null) partialFromDay = i + 1;
    run += s.totals.revenueCents[k];
    lastDay = i + 1;
    return run;
  });
  if (lastDay === 0) return null;
  return { period, label: periodYearLabel(period), cumulative, gaps, partialFromDay, lastDay };
}

// ---- Sales: sell-through and average selling price for the biggest categories ----

export type CategoryBars = {
  rows: { category: string; revenueCents: number; sellThroughPct: number | null; aspCents: number | null }[];
  sellThrough: { overall: number | null; target: number | null };
  asp: { overall: number | null; target: number | null };
  /** Last day with data when the month is not over yet (sell-through reads low until it ends); null for a finished month. */
  inProgressThrough: string | null;
};

// ---- Category + customer: repeat buyer rate, this year vs the same month last year ----

export type RepeatBuyers = {
  target: number | null;
  months: {
    period: string;
    month: string;                // "Sep"
    thisYear: number | null;
    lastYear: number | null;
    lastYearPeriod: string;
    inProgress: boolean;          // month not finished: a within-month repeat rate is not comparable yet
    selected: boolean;
  }[];
};

const repeatDef = KPI_DEFINITIONS.find(d => d.id === "repeat_buyer_rate")!;
const repeatRate = cache(async (period: string) => repeatDef.compute(await getPeriodFacts(period), null));

export type ScorecardCharts = {
  revenuePace: RevenuePace | null;
  categories: CategoryBars | null;
  repeatBuyers: RepeatBuyers | null;
};

/** kpis may be a promise, so the charts' own loads start before the screen's KPIs are ready. */
export async function getScorecardCharts(range: DataRange, period: string, kpisIn: Kpi[] | Promise<Kpi[]>): Promise<ScorecardCharts> {
  const ly = priorYearPeriod(period);
  const [kpis, current, lastYear, view, repeat] = await Promise.all([
    kpisIn,
    paceSeries(period, range.latestDate, range.completeDate),
    paceSeries(ly, range.latestDate, range.completeDate),
    getScorecardView(period),
    Promise.all(range.periods.map(async p => {
      const lyp = priorYearPeriod(p);
      const [thisYear, lastYear] = await Promise.all([repeatRate(p), repeatRate(lyp)]);
      const inProgress = periodBounds(p).end > range.completeDate;
      return { period: p, month: periodShort(p), thisYear: inProgress ? null : thisYear, lastYear, lastYearPeriod: lyp, inProgress, selected: p === period };
    })),
  ]);

  const kpi = (id: string) => kpis.find(k => k.id === id);
  const { start, end } = periodBounds(period);
  const revenuePace: RevenuePace | null = current
    ? { days: dateRange(start, end).length, targetCents: kpi("total_revenue")?.target ?? null, current, lastYear }
    : null;

  const top = view.topCategoriesByRevenue.map(t => view.categories.find(c => c.category === t.category)).filter(c => c != null);
  const categories: CategoryBars | null = top.length > 0
    ? {
        rows: top.map(c => ({ category: c.category, revenueCents: c.revenueCents, sellThroughPct: c.sellThroughPct, aspCents: c.aspCents })),
        sellThrough: { overall: kpi("sell_through_rate")?.value ?? null, target: kpi("sell_through_rate")?.target ?? null },
        asp: { overall: kpi("avg_selling_price")?.value ?? null, target: kpi("avg_selling_price")?.target ?? null },
        inProgressThrough: end > range.completeDate ? [end, range.latestDate].sort()[0] : null,
      }
    : null;

  const months = repeat.filter(m => m.thisYear != null || m.lastYear != null || m.inProgress);
  const repeatBuyers: RepeatBuyers | null = months.some(m => m.thisYear != null || m.lastYear != null)
    ? { target: kpi("repeat_buyer_rate")?.target ?? null, months }
    : null;

  return { revenuePace, categories, repeatBuyers };
}
