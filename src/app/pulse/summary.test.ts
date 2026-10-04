import assert from "node:assert/strict";
import test from "node:test";
import { baselineLabel, buildPulseSummary, significance, statsOf, type PulseBaseline, type SummaryInput } from "./summary";

const FRIDAY = "2026-10-02";

// Four earlier Fridays: revenue mean $4,800 (sd ≈ $183), orders mean 150 (sd ≈ 8.2), customers mean 140 (sd ≈ 8.2).
const baseline: PulseBaseline = {
  weekday: "Friday",
  dates: ["2026-09-25", "2026-09-18", "2026-09-11", "2026-09-04"],
  wanted: 4,
  stats: {
    revenue: statsOf([460000, 480000, 500000, 480000]),
    orders: statsOf([140, 150, 160, 150]),
    customers: statsOf([130, 140, 150, 140]),
  },
};

const rows = (sg: number, amazon: number | null, ebay: number, other: number): SummaryInput["rows"] => [
  { label: "ShopGoodwill", status: "ok", revenueCents: sg },
  { label: "Amazon", status: amazon == null ? "missing" : "ok", revenueCents: amazon },
  { label: "eBay", status: "ok", revenueCents: ebay },
  { label: "Other e-commerce", status: "ok", revenueCents: other },
];

const day = (over: Partial<SummaryInput>): SummaryInput => ({
  date: FRIDAY, partial: false, baseline,
  rows: rows(281000, 100000, 60000, 27389),
  totals: { revenueCents: 468389, customers: 140, orders: 150 },
  ...over,
});

test("statsOf uses the sample standard deviation and has no spread for one value", () => {
  assert.deepEqual(statsOf([2, 4]), { mean: 3, sd: Math.SQRT2, n: 2 });
  assert.deepEqual(statsOf([5]), { mean: 5, sd: null, n: 1 });
  assert.deepEqual(statsOf([]), { mean: 0, sd: null, n: 0 });
});

test("significance stays neutral inside the threshold and flags beyond it", () => {
  const s = statsOf([100, 110, 90]); // mean 100, sd 10
  assert.equal(significance(105, s, "Friday").level, "neutral");
  assert.equal(significance(111, s, "Friday").level, "up");
  assert.equal(significance(80, s, "Friday").note, "Unusually low for a Friday");
  assert.equal(significance(105, s, "Friday", 0.25).level, "up"); // tunable threshold
  assert.equal(significance(50, statsOf([100]), "Friday").level, "neutral"); // one point: no spread
});

test("neutral day: revenue delta and top marketplace, nothing called unusual", () => {
  assert.equal(
    buildPulseSummary(day({})),
    "Friday closed at $4,684, 2% below a typical Friday. ShopGoodwill carried 60% of revenue.",
  );
});

test("down day: unusually low revenue and light orders", () => {
  const text = buildPulseSummary(day({
    rows: rows(250000, 90000, 50000, 20000),
    totals: { revenueCents: 410000, customers: 138, orders: 120 },
  }));
  assert.equal(text, "Friday closed at $4,100, unusually low at 15% below a typical Friday. ShopGoodwill carried 61% of revenue; orders were unusually light.");
});

test("up day: unusually high revenue, heavy orders and many customers", () => {
  const text = buildPulseSummary(day({
    rows: rows(330000, 120000, 70000, 30000),
    totals: { revenueCents: 550000, customers: 170, orders: 180 },
  }));
  assert.equal(text, "Friday closed at $5,500, unusually high at 15% above a typical Friday. ShopGoodwill carried 60% of revenue; orders were unusually heavy and customers were unusually many.");
});

test("a non-reporting marketplace is named, and totals still describe the reporting ones", () => {
  const text = buildPulseSummary(day({
    rows: rows(281000, null, 60000, 27389),
    totals: { revenueCents: 368389, customers: 100, orders: 110 },
    baseline: { ...baseline, stats: { revenue: statsOf([360000, 370000, 380000]), orders: statsOf([105, 110, 115]), customers: statsOf([95, 100, 105]) }, dates: baseline.dates.slice(0, 3) },
  }));
  assert.equal(text, "Friday closed at $3,684, in line with a typical Friday. ShopGoodwill carried 76% of revenue (Amazon has not reported yet).");
});

test("partial day and no history are never compared", () => {
  assert.match(buildPulseSummary(day({ partial: true })), /^Friday so far: \$4,684 .*not compared yet\.\s/);
  assert.match(buildPulseSummary(day({ baseline: null })), /no earlier Fridays to compare with/);
  assert.equal(buildPulseSummary(day({ rows: rows(0, null, 0, 0).map(r => ({ ...r, status: "missing" as const })) })), "No marketplace has reported for Friday yet.");
});

test("baseline label says when fewer than four weeks exist", () => {
  assert.equal(baselineLabel(baseline), "vs last 4 Fridays");
  assert.equal(baselineLabel({ ...baseline, dates: ["2026-09-25"] }), "vs last Friday (only 1 in the data)");
});
