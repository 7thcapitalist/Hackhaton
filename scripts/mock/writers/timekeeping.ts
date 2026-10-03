/**
 * Timekeeping / payroll export (Paylocity-style "timecard detail by earning
 * code"), one file per month (current month partial):
 * data/fixtures/timekeeping/timekeeping_YYYY-MM.csv
 *
 * Layout [guess; see docs/sources/timekeeping.md]: header on line 1, one row
 * per employee, day and earning code (REG, OT). Employee ids are pseudonyms;
 * no names. Includes store/warehouse departments the parser must drop.
 */
import { csvRow, lines, usDay } from "../format";
import { END_DATE, type MockModel } from "../model";
import { dailyUpload, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Company Code", "Employee Id", "Department", "Job Title", "Work Date", "Earning Code", "Hours"];

export function writeTimekeeping(model: MockModel): FixtureFile[] {
  const { laborDays, itemPeriods } = model.ops;
  return itemPeriods.map((period) => {
    const body = [csvRow(HEADER)];
    for (const d of laborDays) {
      if (!d.date.startsWith(period)) continue;
      body.push(csvRow(["GWM01", d.employee, d.department, d.jobTitle, usDay(d.date), "REG", d.regularHours.toFixed(2)]));
      if (d.overtimeHours > 0) {
        body.push(csvRow(["GWM01", d.employee, d.department, d.jobTitle, usDay(d.date), "OT", d.overtimeHours.toFixed(2)]));
      }
    }
    const current = period === END_DATE.slice(0, 7);
    return {
      sourceId: "timekeeping",
      path: `timekeeping/timekeeping_${period}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: current ? dailyUpload(END_DATE, 33) : monthlyUpload(period, 31),
    };
  });
}
