import ExcelJS from "exceljs";
import { spreadsheetText } from "./csv";
import { pulseTable } from "./pulse";
import { scorecardTables } from "./scorecard";
import type { PulseExportData, ReportCell, ReportTable, ScorecardExportData } from "./types";

function excelValue(value: ReportCell): ExcelJS.CellValue {
  if (value === null) return null;
  if (typeof value === "object") {
    const digits = value.numeric.replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/0+$/, "");
    // Excel only retains 15 significant digits. Large amounts are stored as text
    // rather than silently rounding away cents; raw columns retain the source.
    return digits.length > 15 ? value.numeric : Number(value.numeric);
  }
  if (typeof value === "number" && Math.abs(value) >= 1e15) return String(value);
  return typeof value === "string" ? spreadsheetText(value) : value;
}

export async function tablesToXlsx(tables: ReportTable[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mission Control";
  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.name, {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.columns = table.columns.map(column => ({ header: column,
      width: ["label", "marketplace", "category", "note"].includes(column) ? 32 :
        ["timezone", "missing_channels", "percent_scale"].includes(column) ? 34 : 18 }));
    for (const row of table.rows) {
      if (row.length !== table.columns.length) throw new Error("Report column count mismatch");
      const added = sheet.addRow(row.map(excelValue));
      row.forEach((value, i) => {
        const cell = added.getCell(i + 1);
        cell.alignment = { vertical: "top", wrapText: true };
        if (typeof value === "object" && value !== null) cell.numFmt = "0.00########";
        if (typeof cell.value === "string") cell.numFmt = "@";
      });
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: table.columns.length } };
    sheet.getRow(1).font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18354A" } };
    sheet.getRow(1).height = 30;
    sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function pulseXlsx(view: PulseExportData) { return tablesToXlsx([pulseTable(view)]); }
export function scorecardXlsx(view: ScorecardExportData) { return tablesToXlsx(scorecardTables(view)); }
