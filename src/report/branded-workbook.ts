import ExcelJS from "exceljs";
import JSZip from "jszip";
import { spreadsheetText } from "../export/csv";
import { goodwillLogoPng } from "./monthly-brand";

export type WorkbookValue = string | number | Date | null;
const blue = "FF01529C", light = "FFF1F4F8", ink = "FF0E1A28";
function safe(value: WorkbookValue): ExcelJS.CellValue {
  if (value === "") return null;
  if (typeof value === "string") return spreadsheetText(value);
  if (typeof value === "number" && String(value).replace(/[^0-9]/g, "").replace(/^0+|0+$/g, "").length > 15) return String(value);
  return value;
}
export interface WorkbookMetadata {
  periodLabel: string; unit: string; generatedAt: string; version: string;
  profile?: string; scope?: string; freezeHeaders?: boolean;
}
/** The approved monthly workbook's presentation, shared by all report profiles. */
export function brandedWorkbook(meta: WorkbookMetadata) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Goodwill Michiana - Mission Control prototype";
  wb.created = new Date(meta.generatedAt); wb.modified = new Date(meta.generatedAt);
  const logo = wb.addImage({ base64: goodwillLogoPng, extension: "png" });
  const generated = new Date(meta.generatedAt).toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  let tableNumber = 0;
  function sheet(name: string, title: string, subtitle: string, headers: string[], widths: number[], values: WorkbookValue[][]): ExcelJS.Worksheet {
    if (values.length > 1_048_569) throw new Error("Report detail exceeds Excel's row limit; no records were truncated");
    const view: Partial<ExcelJS.WorksheetView> = meta.freezeHeaders
      ? { state: "frozen", ySplit: 7, topLeftCell: "A8", activeCell: "A8", showGridLines: false, zoomScale: 90 }
      : { state: "normal", activeCell: "A1", showGridLines: false, zoomScale: 90 };
    const ws = wb.addWorksheet(name, { views: [view],
      properties: { tabColor: { argb: ["Scorecard", "Overview", "Indicators", "Categories", "Category Rankings", "Marketplaces", "Channels"].includes(name) ? blue : "FF8296A8" } },
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } } });
    ws.columns = widths.map(width => ({ width }));
    const placement = { tl: { nativeCol: 0, nativeColOff: 19050, nativeRow: 0, nativeRowOff: 19050 },
      br: { nativeCol: 0, nativeColOff: 381000, nativeRow: 1, nativeRowOff: 140970 }, editAs: "oneCell" } as unknown as ExcelJS.ImageRange;
    ws.addImage(logo, placement);
    ws.getCell("B1").value = title; ws.getCell("B1").font = { name: "Arial", size: 18, bold: true, color: { argb: blue } }; ws.getRow(1).height = 30;
    ws.getCell("B2").value = `Goodwill Michiana · ${meta.periodLabel} · ${meta.unit} · Prototype`; ws.getRow(2).height = 24;
    if (meta.scope || meta.profile) {
      ws.mergeCells(3, 1, 3, headers.length); ws.getCell("A3").value = `${meta.profile ?? ""} · ${meta.scope ?? ""} · Proposed profile; not approved by Goodwill`;
      ws.getCell("A3").font = { name: "Arial", size: 11, color: { argb: ink } }; ws.getCell("A3").alignment = { wrapText: true, vertical: "middle" }; ws.getRow(3).height = 32;
    }
    ws.getCell("A4").value = subtitle; ws.getCell("A4").font = { name: "Arial", size: 11, color: { argb: ink } }; ws.getRow(4).height = Math.max(32, Math.ceil(subtitle.length / widths.reduce((sum, w) => sum + w, 0)) * 16 + 10);
    ws.mergeCells(4, 1, 4, headers.length);
    ws.getCell("A4").alignment = { wrapText: true, vertical: "middle" };
    ws.getCell("A5").value = `Data version ${meta.version} · Generated ${generated} ET · ${meta.generatedAt} (UTC)`;
    ws.mergeCells(5, 1, 5, headers.length); ws.getRow(5).height = 20; ws.getCell("A5").font = { name: "Arial", size: 10, color: { argb: "FF556375" } };
    if (meta.profile && headers.length === 2) {
      // Narrow detail tables keep the approved logo/title band without clipping
      // the title or stretching their numeric column into unused whitespace.
      const subtitle = ws.getCell("B2").value;
      ws.getCell("B1").value = null; ws.getCell("B2").value = null;
      ws.mergeCells("A1:B1"); ws.mergeCells("A2:B2");
      ws.getCell("A1").value = title; ws.getCell("A1").font = { name: "Arial", size: 18, bold: true, color: { argb: blue } };
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell("A2").value = subtitle; ws.getCell("A2").alignment = { horizontal: "center", wrapText: true, vertical: "middle" }; ws.getRow(2).height = 36;
      ws.getCell("A5").alignment = { wrapText: true, vertical: "middle" };
      ws.getRow(5).height = Math.ceil(String(ws.getCell("A5").value).length / widths.reduce((a, b) => a + b, 0)) * 14 + 8;
    }
    ws.getRow(7).values = headers; ws.getRow(7).height = 32;
    ws.getRow(7).eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } }; cell.font = { name: "Arial", size: 11, color: { argb: "FFFFFFFF" }, bold: true }; cell.alignment = { wrapText: true, vertical: "middle" }; cell.border = { right: { style: "thin", color: { argb: "FFFFFFFF" } } }; });
    for (const valuesRow of values) {
      if (valuesRow.length !== headers.length) throw new Error("Report workbook column mismatch");
      const row = ws.addRow(valuesRow.map(safe));
      const lines = valuesRow.reduce<number>((max, value, i) => {
        const displayed = value instanceof Date ? "yyyy-mm-dd" : String(value ?? "");
        return Math.max(max, displayed.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, widths[i] - 2))), 0));
      }, 1);
      row.height = Math.max(28, lines * 15 + 10);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: "Arial", size: 11, color: { argb: ink } };
        cell.alignment = { vertical: "middle", wrapText: true, horizontal: typeof cell.value === "number" ? "right" : "left", indent: 1 };
        if (row.number % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: light } };
        if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd";
        if (typeof cell.value === "string") cell.numFmt = "@";
      });
    }
    if (values.length) ws.addTable({ name: `MonthlyDetail${++tableNumber}`, ref: "A7", headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: headers.map(name => ({ name, filterButton: true })), rows: values.map(row => row.map(safe)) });
    ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: Math.max(7, ws.rowCount), column: headers.length } };
    ws.pageSetup.printArea = `A1:${ws.getColumn(headers.length).letter}${ws.rowCount}`;
    ws.pageSetup.printTitlesRow = "1:7";
    ws.headerFooter.oddFooter = "&LPrototype | Mission Control&C&P of &N";
    return ws;
  }
  async function finish(): Promise<Uint8Array> {
    const archive = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    for (const file of archive.file(/^xl\/tables\/table\d+\.xml$/)) archive.file(file.name, (await file.async("string")).replace('totalsRowShown="1"', 'totalsRowShown="0" totalsRowCount="0"'));
    return archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  return { workbook: wb, sheet, finish, nextTableName: () => `MonthlyDetail${++tableNumber}` };
}
