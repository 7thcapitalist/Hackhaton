import { scorecardCsv } from "@/export/scorecard";
import { reportProvider } from "@/export/provider";
import { download, reportFailure } from "@/export/http";
import { ReportError, validPeriod } from "@/export/validation";
import { profileDownload } from "@/export/profile-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const period = params.get("period") ?? "";
    const format = params.get("format") ?? "csv";
    if (!validPeriod(period)) throw new ReportError(400, "invalid_period", "Use a month in YYYY-MM format.");
    if (format !== "csv" && format !== "xlsx" && format !== "pdf") throw new ReportError(400, "invalid_format", "Supported formats: csv, xlsx, pdf.");
    if (format !== "csv") return await profileDownload(request, "monthly", period, format);
    return download(scorecardCsv(await reportProvider.loadScorecard(period)), `coo-scorecard-${period}.csv`, "text/csv; charset=utf-8");
  } catch (error) { return reportFailure(error); }
}
