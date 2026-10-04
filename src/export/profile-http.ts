import { profileProvider } from "../report/profile-provider";
import type { Frequency } from "../report/profiles";
import { download } from "./http";
import { requireMonthlyDetailAccess } from "./monthly-access";
import { ReportError, validBusinessDate, validPeriod } from "./validation";

/** Demo activation is server-owned. Query parameters never grant access. */
export async function profileDownload(request: Request, frequency: Frequency, period: string, format: "pdf" | "xlsx" | "html") {
  if (!(frequency === "daily" ? validBusinessDate(period) : validPeriod(period))) throw new ReportError(400, "invalid_period", "Select a valid report period.");
  const allowed = new Set([frequency === "daily" ? "date" : "period", "format"]);
  for (const key of new URL(request.url).searchParams.keys()) {
    if (!allowed.has(key)) throw new ReportError(400, "unsupported_filter", "This demonstration report supports only the selected date or month; additional filters are not supported.");
  }
  if (process.env.DEMO_REPORT_EXPORTS_ENABLED !== "true") requireMonthlyDetailAccess(request);
  const pack = await profileProvider.load(frequency, period);
  const headers = { "X-Report-Synthetic": "true", "X-Report-Version": pack.model.snapshot.version,
    "X-Report-Generated-At": pack.model.snapshot.generatedAt, "X-Report-Profile": "ceo" };
  if (format === "xlsx") return download(pack.xlsx, pack.xlsxName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers);
  if (format === "html") return download(pack.html, pack.pdfName.replace(/\.pdf$/, ".html"), "text/html; charset=utf-8", headers);
  return download(pack.pdf, pack.pdfName, "application/pdf", headers);
}
