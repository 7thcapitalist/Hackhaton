import assert from "node:assert/strict";
import test from "node:test";
import { countsLabel, formatTarget, formatValue, kpiChange, kpiStatus, statusCounts } from "./kpiFormat";

test("status respects the better direction and the near band", () => {
  assert.equal(kpiStatus({ value: 56.9, target: 55, higherIsBetter: true }), "on");
  assert.equal(kpiStatus({ value: 69.87, target: 70, higherIsBetter: true }), "near"); // within 5%
  assert.equal(kpiStatus({ value: 42.7, target: 55, higherIsBetter: true }), "off");
  assert.equal(kpiStatus({ value: 7.6, target: 12, higherIsBetter: false }), "on");  // fewer days is better
  assert.equal(kpiStatus({ value: 961, target: 800, higherIsBetter: false }), "off");
  assert.equal(kpiStatus({ value: 82944, target: null, higherIsBetter: true }), "none");
  assert.equal(kpiStatus({ value: null, target: 55, higherIsBetter: true }), "awaiting");
});

test("targets carry their direction", () => {
  assert.equal(formatTarget({ unit: "percent", target: 55, higherIsBetter: true }), "≥ 55.0%");
  assert.equal(formatTarget({ unit: "days", target: 12, higherIsBetter: false }), "≤ 12.0 days");
  assert.equal(formatTarget({ unit: "count", target: 800, higherIsBetter: false }), "≤ 800");
  assert.equal(formatTarget({ unit: "cents_per_hour", target: 7000, higherIsBetter: true }), "≥ $70.00/hr");
  assert.equal(formatTarget({ unit: "cents", target: null, higherIsBetter: true }), "No target");
});

test("change is good or bad by direction, points for percents, flat when it rounds to zero", () => {
  assert.deepEqual(
    [kpiChange({ unit: "percent", value: 56.9, previous: 53.4, higherIsBetter: true })?.text, kpiChange({ unit: "percent", value: 56.9, previous: 53.4, higherIsBetter: true })?.tone],
    ["↑ 3.5 pts", "good"],
  );
  assert.equal(kpiChange({ unit: "count", value: 961, previous: 815, higherIsBetter: false })?.tone, "bad"); // backlog grew
  assert.equal(kpiChange({ unit: "percent", value: 25.1, previous: 13.5, higherIsBetter: false })?.text, "↑ 11.6 pts");
  assert.equal(kpiChange({ unit: "days", value: 7.6, previous: 7.6, higherIsBetter: false })?.text, "flat");
  assert.equal(kpiChange({ unit: "cents", value: 1000, previous: 1000.4, higherIsBetter: true })?.tone, "flat");
  assert.equal(kpiChange({ unit: "cents", value: 14317955, previous: 14292240, higherIsBetter: true })?.text, "↑ 0.2%");
  assert.equal(kpiChange({ unit: "cents", value: 5, previous: null, higherIsBetter: true }), null);
  assert.equal(kpiChange({ unit: "cents", value: 5, previous: 0, higherIsBetter: true }), null);
});

test("status counts leave out KPIs without a target or a value", () => {
  const c = statusCounts([
    { value: 1, target: 1, higherIsBetter: true },     // on
    { value: 0.97, target: 1, higherIsBetter: true },  // near
    { value: 0.5, target: 1, higherIsBetter: true },   // off
    { value: 3, target: null, higherIsBetter: true },  // no target
    { value: null, target: 1, higherIsBetter: true },  // awaiting
  ]);
  assert.deepEqual(c, { on: 1, near: 1, off: 1, scored: 3 });
  assert.equal(countsLabel(c), "1 of 3 on track · 1 near");
  assert.equal(countsLabel(c, true), "1 of 3 on track · 1 near · 1 off");
  assert.equal(countsLabel({ on: 2, near: 0, off: 0, scored: 2 }), "2 of 2 on track");
});

test("scores keep their decimals and move in their own units; per-day rates say so", () => {
  assert.deepEqual(formatValue({ unit: "score", value: 4.62 }), { value: "4.62", suffix: "" }); // CSAT of 5
  assert.deepEqual(formatValue({ unit: "score", value: 38.89 }), { value: "38.9", suffix: "" }); // NPS
  assert.deepEqual(formatValue({ unit: "per_day", value: 138.5 }), { value: "138.5", suffix: "per day" });
  assert.deepEqual(formatValue({ unit: "days", value: 19.7 }), { value: "19.7", suffix: "days" });
  assert.equal(formatTarget({ unit: "per_day", target: 150, higherIsBetter: true }), "≥ 150.0/day");
  assert.equal(kpiChange({ unit: "score", value: 4.62, previous: 4.6, higherIsBetter: true })?.text, "↑ 0.02");
  assert.equal(kpiChange({ unit: "score", value: 44.05, previous: 38.89, higherIsBetter: true })?.text, "↑ 5.16");
  assert.equal(kpiChange({ unit: "score", value: -5, previous: 0, higherIsBetter: true })?.tone, "bad"); // NPS can cross zero
  assert.equal(kpiChange({ unit: "score", value: 4.6, previous: 4.6, higherIsBetter: true })?.text, "flat");
  assert.equal(kpiChange({ unit: "per_day", value: 138.5, previous: 168.1, higherIsBetter: true })?.text, "↓ 17.6%");
});
