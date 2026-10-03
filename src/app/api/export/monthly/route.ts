import { reportProvider } from "@/export/provider";
import { download, reportFailure } from "@/export/http";
import { ReportError, validPeriod } from "@/export/validation";
import { monthlyReportHtml } from "@/report/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const period = params.get("period") ?? "";
    if (!validPeriod(period)) throw new ReportError(400, "invalid_period", "Use a month in YYYY-MM format.");
    if ((params.get("format") ?? "html") !== "html") throw new ReportError(400, "invalid_format", "Supported format: html.");
    return download(monthlyReportHtml(await reportProvider.loadScorecard(period)), `monthly-report-${period}.html`, "text/html; charset=utf-8");
  } catch (error) { return reportFailure(error); }
}
