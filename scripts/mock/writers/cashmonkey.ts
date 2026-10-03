/**
 * Cash Monkey "Orders, full month" export, one file per closed month:
 * data/fixtures/cashmonkey/cashmonkey_YYYY-MM.csv
 *
 * Layout = src/sources/__samples__/other/cashmonkey_2026-09.csv: two title
 * lines and an empty line, the header, one row per bulk lot, an empty line,
 * a "Total" footer. LF line endings. Money "$1,080.00" (quoted when it has a
 * comma), credits in parentheses. Dates "09/01/2026" (a late lot carries a
 * time). Statuses: Completed / Paid / Shipped / Cancelled / Refunded / Credit.
 */
import { csvRow, lines, usDay, usDayTime, usdParens } from "../format";
import type { MockModel } from "../model";
import { MONTHLY_PERIODS, lastDayOf, monthlyUpload } from "../schedule";
import type { FixtureFile } from "../types";

const HEADER = ["Order ID", "Order Date", "Item Count", "Order Total", "Fees", "Net", "Status"];

export function writeCashmonkey(model: MockModel): FixtureFile[] {
  return MONTHLY_PERIODS.map((period) => {
    const rows = model.cashMonkey.filter((c) => c.date.startsWith(period));
    let gross = 0;
    let fees = 0;
    const body = [
      csvRow(["Cash Monkey - Orders Export", "", "", "", "", "", ""]),
      csvRow([`Account: GW-MICHIANA-TEST  Range: ${usDay(`${period}-01`)} - ${usDay(lastDayOf(period))}`, "", "", "", "", "", ""]),
      csvRow(["", "", "", "", "", "", ""]),
      csvRow(HEADER),
      ...rows.map((c) => {
        gross += c.grossCents;
        fees += c.feeCents;
        return csvRow([
          c.orderId,
          c.withTime ? usDayTime(c.ts) : usDay(c.date),
          String(c.itemCount),
          usdParens(c.grossCents),
          usdParens(c.feeCents),
          usdParens(c.grossCents - c.feeCents),
          c.status,
        ]);
      }),
      csvRow(["", "", "", "", "", "", ""]),
      csvRow(["Total", "", "", usdParens(gross), usdParens(fees), usdParens(gross - fees), ""]),
    ];
    return {
      sourceId: "cashmonkey",
      path: `cashmonkey/cashmonkey_${period}.csv`,
      content: lines(body, "\n"),
      uploadedAt: monthlyUpload(period, 0),
    };
  });
}
