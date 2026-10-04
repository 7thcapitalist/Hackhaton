import type { MonthlyData } from "./monthly-data";
import { monthlyReportPdf } from "./monthly-pdf";
import { scorecardXlsx } from "../export/xlsx";

export interface MonthlyPackage { data: MonthlyData; pdf: Uint8Array; xlsx: Uint8Array; pdfName: string; xlsxName: string }
/** Render exactly one collected input. No source fetch occurs while rendering. */
export async function monthlyPackage(data: MonthlyData): Promise<MonthlyPackage> {
  const pdf = await monthlyReportPdf(data);
  const xlsx = await scorecardXlsx(data);
  return { data, pdf, xlsx, pdfName: `Goodwill-Monthly-Report-${data.scorecard.period}.pdf`, xlsxName: `Goodwill-Monthly-Data-${data.scorecard.period}.xlsx` };
}
