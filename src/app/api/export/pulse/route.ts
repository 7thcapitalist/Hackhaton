import { pulseCsv, pulseIsPartial } from "@/export/pulse";
import { profileDownload } from "@/export/profile-http";
import { reportProvider } from "@/export/provider";
import { download, reportFailure } from "@/export/http";
import { ReportError, validBusinessDate } from "@/export/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? "";
    if (!validBusinessDate(date)) throw new ReportError(400, "invalid_date", "Use a real date in YYYY-MM-DD format.");
    const format = params.get("format") ?? "csv";
    if (format !== "csv" && format !== "xlsx" && format !== "pdf") {
      throw new ReportError(400, "invalid_format", "Supported formats: csv, xlsx, pdf.");
    }
    if (format !== "csv") return await profileDownload(request, "daily", date, format);
    const view = await reportProvider.loadPulse(date);
    const partial = pulseIsPartial(view);
    return download(pulseCsv(view), `daily-pulse-${date}.csv`, "text/csv; charset=utf-8",
      { "X-Report-Synthetic": String(view.isSynthetic), "X-Report-Status": partial ? "partial" : "complete" });
  } catch (error) { return reportFailure(error); }
}
