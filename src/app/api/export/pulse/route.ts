import { pulseCsv, pulseIsPartial } from "@/export/pulse";
import { pulseXlsx } from "@/export/xlsx";
import { loadPulse } from "@/export/provider";
import { download, reportFailure } from "@/export/http";
import { ReportError, validBusinessDate } from "@/export/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? "";
    if (!validBusinessDate(date)) throw new ReportError(400, "invalid_date", "Use a real date in YYYY-MM-DD format.");
    const format = params.get("format") ?? "csv";
    if (format !== "csv" && format !== "xlsx") {
      throw new ReportError(400, "invalid_format", "Supported formats: csv, xlsx.");
    }
    const view = await loadPulse(date);
    const partial = pulseIsPartial(view);
    return download(format === "csv" ? pulseCsv(view) : await pulseXlsx(view),
      `daily-pulse-${date}.${format}`, format === "csv" ? "text/csv; charset=utf-8" :
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { "X-Report-Synthetic": String(view.isSynthetic), "X-Report-Status": partial ? "partial" : "complete" });
  } catch (error) { return reportFailure(error); }
}
