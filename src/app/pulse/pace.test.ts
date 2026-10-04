import assert from "node:assert/strict";
import test from "node:test";
import { computePace, cumulative } from "./pace";

test("ahead of a straight-line pace", () => {
  // 10 of 30 days at $5,000/day against $145,000: expected $48,333, have $50,000.
  const p = computePace({ daily: Array(10).fill(500000), daysInMonth: 30, targetCents: 14500000 });
  assert.equal(p.mtdCents, 5000000);
  assert.equal(p.expectedCents, 4833333);
  assert.equal(p.status, "ahead");
  assert.equal(p.gapCents, 166667);
  assert.equal(p.projectedCents, 15000000);
  assert.equal(Math.round(p.pctOfTarget! * 10) / 10, 34.5);
});

test("slightly behind is near; further behind is behind", () => {
  // Sep 25 as seeded: $118,060 vs $120,833 expected (2.3% short) -> near.
  assert.equal(computePace({ daily: [...Array(24).fill(491917), 11806000 - 24 * 491917], daysInMonth: 30, targetCents: 14500000 }).status, "near");
});

test("behind pace, projection below target", () => {
  const p = computePace({ daily: [400000, 450000], daysInMonth: 31, targetCents: 14500000 });
  assert.equal(p.status, "behind"); // 9% short of the straight-line pace
  assert.equal(p.expectedCents, 935484);
  assert.equal(p.gapCents, 850000 - 935484);
  assert.equal(p.projectedCents, 13175000);
});

test("no target or no complete day yet: no pace call", () => {
  assert.equal(computePace({ daily: [500000], daysInMonth: 30, targetCents: null }).status, "none");
  const none = computePace({ daily: [], daysInMonth: 31, targetCents: 14500000 });
  assert.deepEqual([none.status, none.mtdCents, none.projectedCents, none.pctOfTarget], ["none", 0, 0, 0]);
});

test("cumulative running total", () => {
  assert.deepEqual(cumulative([1, 2, 3]), [1, 3, 6]);
  assert.deepEqual(cumulative([]), []);
});
