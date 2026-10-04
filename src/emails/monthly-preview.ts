import { getReportOrigin } from "./pulse";
import { escapeHtml } from "../report/monthly";
import { monthName } from "../report/monthly-content";
import { originLabel } from "../report/monthly-data";
import type { MonthlyPackage } from "../report/monthly-package";

// Resend permits 40 MB including base64 attachments. Reserve room for sender,
// recipients, headers and MIME overhead; preview never invokes its send API.
export const MAX_MONTHLY_PREVIEW_BYTES = 38_000_000;
export function monthlyEmailPreview(pack: MonthlyPackage, env: Record<string, string | undefined> = process.env) {
  const dashboard = new URL("/scorecard", getReportOrigin(env));
  dashboard.searchParams.set("period", pack.data.scorecard.period);
  const period = monthName(pack.data.scorecard.period);
  if (Buffer.from(pack.pdf.slice(0, 5)).toString() !== "%PDF-" || pack.xlsx[0] !== 0x50 || pack.xlsx[1] !== 0x4b) throw new Error("Monthly attachments are invalid");
  const subject = `Goodwill Michiana monthly report - ${period} [Prototype]`;
  const text = `Please find the ${period} monthly report and data workbook attached.\n\nThe PDF explains the results; the Excel workbook provides the available detail for checking and analysis.\n\nPrototype for review. ${originLabel(pack.data)}\n\nDashboard: ${dashboard}\nData version: ${pack.data.version}`;
  const attachments = [ { filename: pack.pdfName, content: Buffer.from(pack.pdf).toString("base64") }, { filename: pack.xlsxName, content: Buffer.from(pack.xlsx).toString("base64") } ];
  const payload = { subject, text, html: `<p>Please find the ${escapeHtml(period)} monthly report and data workbook attached.</p><p>The PDF explains the results; the Excel workbook provides detail for checking and analysis.</p><p><strong>Prototype for review.</strong> ${escapeHtml(originLabel(pack.data))}</p><p><a href="${escapeHtml(dashboard.toString())}">Open the dashboard for ${escapeHtml(period)}</a></p>`, attachments };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > MAX_MONTHLY_PREVIEW_BYTES) throw new Error("The encoded monthly package exceeds the email preview limit; no records were truncated");
  return { status: "preview_only" as const, sent: false as const, dashboardUrl: dashboard.toString(), encodedBytes: bytes, payload,
    html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Monthly email preview</title><style>body{font:16px/1.5 Arial;color:#232020;max-width:750px;margin:40px auto;padding:20px}h1{color:#01539c}aside{background:#ecf1f5;padding:14px}a{color:#01539c}</style><body><aside><strong>Preview only - no email sent.</strong> Sender, recipients and monthly scheduling have not been configured.</aside><h1>${escapeHtml(subject)}</h1>${payload.html}<p>Attachments: ${escapeHtml(pack.pdfName)} (${pack.pdf.byteLength.toLocaleString("en-US")} bytes); ${escapeHtml(pack.xlsxName)} (${pack.xlsx.byteLength.toLocaleString("en-US")} bytes).</p><p>Shared data version ${pack.data.version} | Generated ${escapeHtml(pack.data.generatedAt)} (UTC).</p></body></html>` };
}
