import { reportFailure } from "@/export/http";
import { ReportError, validPeriod } from "@/export/validation";
import { profileDownload } from "@/export/profile-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const period = params.get("period") ?? "";
    if (!validPeriod(period)) throw new ReportError(400, "invalid_period", "Use a month in YYYY-MM format.");
    const format = params.get("format") ?? "pdf";
    if (format !== "html" && format !== "pdf" && format !== "xlsx") throw new ReportError(400, "invalid_format", "Supported formats: pdf, xlsx, html.");
    return await profileDownload(request, "monthly", period, format);
  } catch (error) { return reportFailure(error); }
}
