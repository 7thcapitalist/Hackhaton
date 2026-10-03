/**
 * Timekeeping / payroll timecard export (Paylocity- or ADP-style "timecard
 * detail by earning code"). Feeds revenue per labor hour, listings and sales
 * per employee, and the processing-labor part of net margin.
 *
 * Layout [guess; docs/sources/timekeeping.md]
 *   Header: Company Code, Employee Id, Department, Job Title, Work Date,
 *           Earning Code, Hours
 *   One row per employee, day and earning code (REG, OT, …). Also accepted:
 *   one row per day with Regular Hours / Overtime Hours columns.
 *
 * Rules
 * - Only e-commerce departments count (department name contains
 *   "e-commerce", "ecommerce" or "ecom"); other rows are dropped silently.
 * - Worked hours only: REG and OT (and DT). PTO/holiday/sick codes are not
 *   labor on the floor and are dropped.
 * - Privacy: employee ids are kept as given (pseudonyms). If the file has a
 *   name column it is ignored, with one warning.
 * - Hours per employee + day are summed; ingest stores one row per
 *   employee + day + source, so a re-upload replaces instead of adding.
 */
import type { ParseContext, ParseResult, ParsedLaborHour, RawTable, SourceParser } from "./types";
import { isBlankRow, normalizeHeader } from "./_shared/table";
import { cellAt, columns, dayOf, emptyResult, headerRowOf, num, periodFromName } from "./_ops";

const COLS = {
  employee: ["Employee Id", "Employee ID", "Employee Number", "Emp Id", "File Number", "Associate ID"],
  department: ["Department", "Department Name", "Cost Center", "Home Department"],
  date: ["Work Date", "Date", "Punch Date", "Pay Date"],
  code: ["Earning Code", "Earnings Code", "Pay Code", "Pay Type"],
  hours: ["Hours", "Total Hours"],
  regular: ["Regular Hours", "REG Hours"],
  overtime: ["Overtime Hours", "OT Hours"],
};
const REQUIRED = [
  ["Employee Id", "Work Date", "Hours"],
  ["Employee Id", "Work Date", "Regular Hours"],
  ["Employee ID", "Date", "Hours"],
];
const ECOM = /e-?\s?com/i;
const WORKED = /^(reg|regular|ot|overtime|dt|double ?time)$/i;
const NAME_COLS = ["employee name", "name", "first name", "last name"];

export const timekeepingParser: SourceParser = {
  sourceId: "timekeeping",
  version: "0.1.0",

  accepts(table: RawTable): boolean {
    const h = headerRowOf(table, REQUIRED);
    if (h < 0) return false;
    const c = columns(table, h, COLS);
    return c.department >= 0;
  },

  parse(table: RawTable, ctx: ParseContext): ParseResult {
    const h = headerRowOf(table, REQUIRED);
    const result = emptyResult(h, table);
    if (h < 0) {
      result.warnings.push({ message: "Timekeeping: header not found (need Employee Id + Work Date + Hours)." });
      return result;
    }
    const c = columns(table, h, COLS);
    if (table[h].map(normalizeHeader).some((x) => NAME_COLS.includes(x))) {
      result.warnings.push({ message: "Timekeeping: the file has an employee name column; it was ignored (only employee ids are stored)." });
    }
    if (c.department < 0) result.warnings.push({ message: "Timekeeping: no Department column; every row counted as e-commerce." });

    const byKey = new Map<string, ParsedLaborHour>();
    for (let i = h + 1; i < table.length; i++) {
      const row = table[i];
      if (isBlankRow(row)) continue;
      const dept = cellAt(row, c.department);
      if (c.department >= 0 && !ECOM.test(dept)) continue;
      const employee = cellAt(row, c.employee);
      const workDate = dayOf(cellAt(row, c.date));
      if (!employee || !workDate) {
        result.warnings.push({ row: i + 1, message: `Skipped row: ${!employee ? "no employee id" : `bad date "${cellAt(row, c.date)}"`}.` });
        continue;
      }
      let hours: number;
      if (c.hours >= 0) {
        const code = cellAt(row, c.code);
        if (code && !WORKED.test(code)) continue; // PTO, holiday, sick…
        hours = num(cellAt(row, c.hours)) ?? NaN;
      } else {
        hours = (num(cellAt(row, c.regular)) ?? 0) + (num(cellAt(row, c.overtime)) ?? 0);
      }
      if (!Number.isFinite(hours)) {
        result.warnings.push({ row: i + 1, message: `Employee ${employee} ${workDate}: hours "${cellAt(row, c.hours)}" not a number.` });
        continue;
      }
      const key = `${employee}|${workDate}`;
      const prev = byKey.get(key);
      if (prev) prev.hours = Math.round((prev.hours + hours) * 100) / 100;
      else byKey.set(key, { employee, team: dept || null, workDate, hours });
    }
    result.laborHours = [...byKey.values()];
    result.period = ctx.period ?? periodFromName(ctx.fileName);
    return result;
  },
};
