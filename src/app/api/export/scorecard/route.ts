import { scorecardCsv } from "@/export/scorecard";
import { scorecardXlsx } from "@/export/xlsx";
import { loadScorecard } from "@/export/provider";
import { download, reportFailure } from "@/export/http";
import { ReportError, validPeriod } from "@/export/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const period = params.get("period") ?? "";
    const format = params.get("format") ?? "csv";
    if (!validPeriod(period)) throw new ReportError(400, "invalid_period", "Use a month in YYYY-MM format.");
    if (format !== "csv" && format !== "xlsx") throw new ReportError(400, "invalid_format", "Supported formats: csv, xlsx.");
    const view = await loadScorecard(period);
    return download(format === "csv" ? scorecardCsv(view) : await scorecardXlsx(view),
      `coo-scorecard-${period}.${format}`, format === "csv" ? "text/csv; charset=utf-8" :
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) { return reportFailure(error); }
}
