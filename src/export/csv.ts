import type { ReportCell, ReportTable } from "./types";

// Quoting alone does not stop spreadsheet formula execution. Text stays text;
// real numeric values (including negative amounts) are never prefixed.
export function spreadsheetText(value: string): string {
  return /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
    ? "'" + value
    : value;
}

function csvCell(value: ReportCell): string {
  const text = value === null ? "" : typeof value === "object" ? value.numeric : typeof value === "string"
    ? spreadsheetText(value) : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

export function tableToCsv(table: ReportTable): string {
  const rows = [table.columns, ...table.rows];
  if (table.rows.some(row => row.length !== table.columns.length)) {
    throw new Error("Report column count mismatch");
  }
  // UTF-8 BOM for Excel, RFC 4180 quoting and CRLF records.
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function centsText(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Money must be safe integer cents");
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return (value < 0n ? "-" : "") + (absolute / 100n) + "." +
    String(absolute % 100n).padStart(2, "0");
}

export function moneyCell(cents: number): { numeric: string } {
  return { numeric: centsText(cents) };
}
