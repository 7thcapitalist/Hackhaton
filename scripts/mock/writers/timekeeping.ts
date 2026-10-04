/**
 * Timekeeping / payroll export (Paylocity-style "timecard detail by earning
 * code"), one file per finished day (daily timecards):
 * data/fixtures/timekeeping/timekeeping_YYYY-MM-DD.csv
 *
 * Layout [guess; see docs/sources/timekeeping.md]: a report title line with
 * the date range, then the header, one row per employee, day and earning code
 * (REG, OT). Employee ids are pseudonyms; no names. Includes store/warehouse
 * departments the parser must drop. Sundays have no punches (title + header only).
 */
import { csvRow, lines, usDay } from "../format";
import type { MockModel } from "../model";
import { DONE_DATES, dailyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Company Code", "Employee Id", "Department", "Job Title", "Work Date", "Earning Code", "Hours"];

export function writeTimekeeping(model: MockModel): FixtureFile[] {
  const { laborDays } = model.ops;
  return DONE_DATES.map((date) => {
    const blank = HEADER.slice(1).map(() => "");
    const body = [csvRow([`Timecard Detail by Earning Code: ${usDay(date)} - ${usDay(date)}`, ...blank]), csvRow(HEADER)];
    for (const d of laborDays) {
      if (d.date !== date) continue;
      body.push(csvRow(["GWM01", d.employee, d.department, d.jobTitle, usDay(d.date), "REG", d.regularHours.toFixed(2)]));
      if (d.overtimeHours > 0) {
        body.push(csvRow(["GWM01", d.employee, d.department, d.jobTitle, usDay(d.date), "OT", d.overtimeHours.toFixed(2)]));
      }
    }
    return {
      sourceId: "timekeeping",
      path: `timekeeping/timekeeping_${date}.csv`,
      content: lines(body, "\r\n"),
      uploadedAt: dailyUpload(date, 33),
    };
  });
}
