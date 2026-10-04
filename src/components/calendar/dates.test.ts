import assert from "node:assert/strict";
import test from "node:test";
import { addMonthsToDate, clamp, monthWeeks, moveByKey, moveMonthByKey } from "./dates";

test("month weeks keep only weeks that touch the month", () => {
  const oct = monthWeeks("2026-10"); // Oct 1, 2026 is a Thursday; Oct 31 a Saturday
  assert.equal(oct.length, 5);
  assert.deepEqual([oct[0][0], oct[0][4], oct[4][6]], ["2026-09-27", "2026-10-01", "2026-10-31"]);
  const feb = monthWeeks("2026-02"); // Feb 1, 2026 is a Sunday; 28 days -> exactly 4 rows
  assert.equal(feb.length, 4);
  assert.equal(feb[3][6], "2026-02-28");
});

test("keys move by day, week, month and to the week's ends", () => {
  assert.equal(moveByKey("2026-10-02", "ArrowLeft"), "2026-10-01");
  assert.equal(moveByKey("2026-09-30", "ArrowRight"), "2026-10-01");
  assert.equal(moveByKey("2026-10-02", "ArrowUp"), "2026-09-25");
  assert.equal(moveByKey("2026-10-02", "ArrowDown"), "2026-10-09");
  assert.equal(moveByKey("2026-10-02", "PageUp"), "2026-09-02");
  assert.equal(moveByKey("2026-10-02", "Home"), "2026-09-27"); // Sunday
  assert.equal(moveByKey("2026-10-02", "End"), "2026-10-03");  // Saturday
  assert.equal(moveByKey("2026-10-02", "Tab"), null);
});

test("month moves clamp the day and stay in range", () => {
  assert.equal(addMonthsToDate("2026-03-31", -1), "2026-02-28");
  assert.equal(clamp("2026-10-03", "2026-08-01", "2026-10-02"), "2026-10-02");
  assert.equal(clamp("2026-07-15", "2026-08-01", "2026-10-02"), "2026-08-01");
});

test("month grid keys move by month and by row of three", () => {
  assert.equal(moveMonthByKey("2026-09", "ArrowUp"), "2026-06");
  assert.equal(moveMonthByKey("2026-09", "Home"), "2026-07");
  assert.equal(moveMonthByKey("2026-09", "End"), "2026-09");
  assert.equal(moveMonthByKey("2026-12", "ArrowRight"), "2027-01");
});
