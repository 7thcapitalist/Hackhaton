import { escapeHtml as e } from "../report/monthly";
import { goodwillLogo } from "../report/monthly-brand";
import { digest } from "../report/profiles";
import type { ProfilePackage } from "../export/profile";
import { MAX_MONTHLY_PREVIEW_BYTES } from "./monthly-preview";
import { getReportOrigin } from "./pulse";

// Official full mark, rather than SVG/data/CID, so editing a Gmail draft cannot
// detach the image. PDF/XLSX retain their embedded, offline logo assets.
export const GOODWILL_EMAIL_LOGO = "https://goodwill-ni.org/wp-content/uploads/2016/03/776px-Goodwill_Industries_Logo.svg_.png";
export interface ReportDocumentLinks { pdf: string; xlsx: string }
function checkedDocumentLinks(links?: ReportDocumentLinks): ReportDocumentLinks | undefined {
  if (!links) return undefined;
  for (const value of [links.pdf, links.xlsx]) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Document links must be absolute HTTPS URLs"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Document links must be absolute HTTPS URLs without credentials");
  }
  return links;
}

/** Future send identity includes recipient, frequency, period, authority and package.
 * This helper neither sends nor supplies the durable duplicate ledger a sender needs.
 */
export function profileAttemptKey(pack: ProfilePackage, approvedRecipientKey: string): string {
  if (!approvedRecipientKey.trim()) throw new Error("A recipient identity is required");
  const { plan } = pack.model.snapshot;
  return digest({ recipient: approvedRecipientKey, frequency: plan.frequency, period: plan.period, grant: plan.access.id, scope: plan.access.scope, profile: plan.profile.id, version: pack.packageVersion });
}

/** Recipient-free preview only. The local link never opens the all-company app. */
export function profileEmailPreview(pack: ProfilePackage) {
  return buildProfileEmail(pack);
}

/** Explicit CEO synthetic demonstration only. Prepares bytes; never sends or grants employee access. */
export function ceoDemoEmail(pack: ProfilePackage, knownDemoOrigin: string, documentLinks?: ReportDocumentLinks) {
  const plan = pack.model.snapshot.plan;
  if (plan.profile.id !== "ceo" || plan.access.scope.kind !== "organization" || plan.access.mode !== "synthetic-demo") throw new Error("Only the CEO synthetic demonstration may use the global demo dashboard");
  const origin = getReportOrigin({ REPORTS_VIEW_ORIGIN: knownDemoOrigin, NODE_ENV: "production" });
  const url = new URL(plan.frequency === "daily" ? "/pulse" : "/scorecard", origin);
  url.searchParams.set(plan.frequency === "daily" ? "date" : "period", plan.period);
  return buildProfileEmail(pack, url.href, checkedDocumentLinks(documentLinks));
}

function buildProfileEmail(pack: ProfilePackage, demoDashboardUrl?: string, documentLinks?: ReportDocumentLinks) {
  if (Buffer.from(pack.pdf.slice(0, 5)).toString() !== "%PDF-" || pack.xlsx[0] !== 0x50 || pack.xlsx[1] !== 0x4b) throw new Error("Both valid attachments are required");
  const m = pack.model, s = m.snapshot, { profile, frequency, access } = s.plan, config = profile.reports[frequency];
  const subject = `Goodwill Michiana | ${config.subjectLabel}${access.scope.kind === "channel" ? " | " + m.scopeLabel : ""} | ${m.periodLabel} [${demoDashboardUrl ? "Demo" : "Prototype"}]`;
  const notices = ["Synthetic prototype. Proposed profiles and permissions are not approved by Goodwill. Real use requires employee authorization."];
  if (access.scope.kind === "channel") notices.push("Channel feed completeness is unconfirmed; customer and operating measures are unavailable at this scope.");
  if (frequency === "daily") notices.push("Daily and month-to-date figures do not establish an approved accounting close.");
  if (s.sourceAsOf) notices.push(`Source status is assessed through ${s.sourceAsOf}; exceptions reflect retrieval time.`);
  notices.push(...m.notices.filter(n => /^\d+ channel-day/.test(n) || n.startsWith("The sum of reporting groups")));
  const mandatory = demoDashboardUrl ? "Demonstration with synthetic data. The proposed CEO profile and source targets are not Goodwill-approved." + (frequency === "daily" ? " Month-to-date figures are not an approved accounting close." : "") : notices.join(" ");
  const dashboardUrl = demoDashboardUrl ?? "Dashboard-Preview.html";
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:3px solid #01529c"><tr><td width="62" style="padding:0 16px 22px 0"><img src="${demoDashboardUrl ? GOODWILL_EMAIL_LOGO : goodwillLogo}" alt="Official Goodwill logo" width="43" style="display:block;height:auto"></td><td style="padding:0 0 22px;color:#01529c;font:16px Arial"><strong>Goodwill Michiana</strong><br><span style="font-size:13px">${e(config.subjectLabel)}</span></td></tr></table>`;
  const attach = (name: string, description: string, url?: string) => `<div style="border-top:1px solid #d8e0e9;padding:12px 0"><strong style="font-size:14px;overflow-wrap:anywhere">${url || !demoDashboardUrl ? `<a href="${e(url ?? name)}" style="color:#01529c;text-decoration:underline">${e(name)}</a>` : e(name)}</strong><p style="margin:5px 0">${e(description)}</p></div>`;
  const blocks = `${header}<p>Dear ${e(profile.email.greeting)},</p><p>${e(profile.email.opening)} <strong>${e(m.periodLabel)}</strong> &middot; ${e(m.scopeLabel)}.</p><ul style="padding-left:20px">${m.highlights.map(h => `<li style="margin:8px 0">${e(h)}</li>`).join("")}</ul><h2 style="font-size:16px;color:#01529c">Your report and supporting data</h2>${attach(pack.pdfName, "PDF - results, comparisons and points for review.", documentLinks?.pdf)}${attach(pack.xlsxName, "Excel - supporting figures, normalized records and source references within this profile's scope.", documentLinks?.xlsx)}<p><a href="${e(dashboardUrl)}" style="display:inline-block;background:#01529c;color:#fff;padding:12px 15px;text-decoration:none;border-radius:3px">${demoDashboardUrl ? "Open the demo dashboard" : "Open this scope's demo dashboard preview"}</a></p><p style="font-size:12px;color:#556375">${demoDashboardUrl ? "Team demonstration using synthetic data. Employee authorization is pending integration." : "Local scoped preview. The authenticated employee dashboard is pending integration."}</p><aside style="background:#f5f7fa;border-left:3px solid #01529c;padding:12px;font-size:12px">${e(mandatory)}</aside>${profile.email.optionalNote ? `<p style="font-size:13px">${e(profile.email.optionalNote)}</p>` : ""}<p>${e(profile.email.signature)}</p><footer style="border-top:1px solid #d8e0e9;padding-top:10px;font-size:11px;color:#556375">Generated ${e(s.generatedAt)} (UTC) &middot; Data version ${e(s.version)}${demoDashboardUrl ? "" : "<br>No send date: this message has not been sent."}</footer>`;
  const text = `Dear ${profile.email.greeting},\n\n${profile.email.opening} ${m.periodLabel} | ${m.scopeLabel}\n\n${m.highlights.join("\n")}\n\nAttached:\n${pack.pdfName} - results and points for review.${documentLinks ? `\n${documentLinks.pdf}` : ""}\n${pack.xlsxName} - supporting detail within this profile's scope.${documentLinks ? `\n${documentLinks.xlsx}` : ""}\n\n${mandatory}\n\n${demoDashboardUrl ? "Synthetic team demo dashboard (employee authorization pending)" : "Local scoped dashboard preview"}: ${dashboardUrl}\n${profile.email.optionalNote}\n\n${profile.email.signature}\nGenerated ${s.generatedAt}.${demoDashboardUrl ? "" : " No email has been sent."}`;
  // Table-cell padding survives Gmail/Outlook sanitization; semantic <main> did not.
  const document = (content: string, preview: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;padding:0;background:#f1f4f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f4f8"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:680px;border:1px solid #d8e0e9;border-radius:12px"><tr><td style="padding:30px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0e1a28">${preview ? `<p style="margin:0 0 22px;font-size:11px;color:#556375">EMAIL PREVIEW &middot; ${demoDashboardUrl ? "Prepared for the authorized CEO demonstration; this preview does not send." : "No recipients, no sending, no active schedule."}</p>` : ""}${content}</td></tr></table></td></tr></table></body></html>`;
  const payload = { subject, text, html: document(blocks, false), attachments: [{ filename: pack.pdfName, content: Buffer.from(pack.pdf).toString("base64") }, { filename: pack.xlsxName, content: Buffer.from(pack.xlsx).toString("base64") }] };
  const encodedBytes = Buffer.byteLength(JSON.stringify(payload));
  if (encodedBytes > MAX_MONTHLY_PREVIEW_BYTES) throw new Error("The complete encoded package exceeds the email limit; no records were truncated");
  return { status: "preview_only" as const, sent: false as const, dashboardUrl, encodedBytes, payload,
    html: document(blocks, true) };
}
