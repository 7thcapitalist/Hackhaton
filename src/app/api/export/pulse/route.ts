import { pulseCsv } from "@/export/pulse";
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
    if ((params.get("format") ?? "csv") !== "csv") {
      throw new ReportError(400, "invalid_format", "Supported format: csv.");
    }
    return download(pulseCsv(await loadPulse(date)), `daily-pulse-${date}.csv`, "text/csv; charset=utf-8");
  } catch (error) { return reportFailure(error); }
}
