import assert from "node:assert/strict";
import test from "node:test";
import { KPI_DEFINITIONS } from "./definitions";
import { revenueGrowthPct } from "./formulas";
import type { PeriodFacts } from "./types";

const facts = (period: string, netCents: number, extra: Partial<PeriodFacts> = {}): PeriodFacts => ({
  period,
  periodEnd: `${period}-28`,
  orders: {
    netCents,
    orderCount: 1,
    paidGrossCents: netCents,
    paidQuantity: 1,
    paidUnitPricesCents: [netCents],
    transactions: 1,
    lastBusinessDate: null,
  },
  buyers: null,
  shipping: null,
  labor: null,
  items: null,
  categories: [],
  priorYear: null,
  marketplace: [],
  ...extra,
});

const growthNote = KPI_DEFINITIONS.find((d) => d.id === "revenue_growth_pct")!.dynamicNote!;

test("finished period: YoY against the full prior-year month", () => {
  const f = facts("2026-09", 11_200, { priorYear: { period: "2025-09", netCents: 10_000 } });
  assert.equal(revenueGrowthPct(f, facts("2026-08", 50_000)), 12);
  assert.equal(growthNote(f), "YoY vs 2025-09.");
});

test("finished period without prior year: MoM against the previous month", () => {
  const f = facts("2026-09", 11_000);
  assert.equal(revenueGrowthPct(f, facts("2026-08", 10_000)), 10);
  assert.equal(growthNote(f), "MoM: no prior-year data.");
});

test("partial period: month to date vs the same days of the prior-year month", () => {
  const f = facts("2026-10", 1_100, {
    priorYear: { period: "2025-10", netCents: 30_000 },
    monthToDate: { throughDay: 3, priorYearNetCents: 1_000, prevMonthNetCents: 2_000 },
  });
  assert.equal(revenueGrowthPct(f, facts("2026-09", 30_000)), 10);
  assert.equal(growthNote(f), "Month to date (Oct 1–3) vs Oct 1–3, 2025.");
});

test("partial period without prior year: month to date vs the same days of the previous month", () => {
  const f = facts("2026-10", 1_500, {
    monthToDate: { throughDay: 3, priorYearNetCents: 0, prevMonthNetCents: 1_000 },
  });
  assert.equal(revenueGrowthPct(f, facts("2026-09", 30_000)), 50);
  assert.equal(growthNote(f), "Month to date (Oct 1–3) vs Sep 1–3 (MoM: no prior-year data).");
});

test("partial period: day range is clamped to the comparison month's length", () => {
  const f = facts("2026-03", 1_000, {
    monthToDate: { throughDay: 30, priorYearNetCents: 0, prevMonthNetCents: 1_000 },
  });
  assert.equal(growthNote(f), "Month to date (Mar 1–30) vs Feb 1–28 (MoM: no prior-year data).");
});

test("no comparison revenue: null", () => {
  const f = facts("2026-10", 1_000, {
    priorYear: { period: "2025-10", netCents: 5_000 },
    monthToDate: { throughDay: 1, priorYearNetCents: 0, prevMonthNetCents: 900 },
  });
  assert.equal(revenueGrowthPct(f, null), null);
  assert.equal(growthNote(f), "Month to date (Oct 1) vs Oct 1, 2025.");
});
