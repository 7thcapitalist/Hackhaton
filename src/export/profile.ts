import { buildProfileModel, type ReportModel } from "../report/profile-model";
import { profileReportHtml, profileWorkbook } from "../report/profile-render";
import { renderReportPdf } from "../report/monthly-pdf";
import { collectProfileSnapshot, type ProfileSnapshot, type ViewReader } from "../report/profile-source";
import { digest, type ReportPlan } from "../report/profiles";

export interface ProfilePackage {
  model: ReportModel; html: string; pdf: Uint8Array; xlsx: Uint8Array;
  pdfName: string; xlsxName: string; packageVersion: string;
}
/** A single entry point for downloads and email attachments. No sending or public route. */
export async function exportProfilePackage(snapshot: ProfileSnapshot): Promise<ProfilePackage> {
  const model = buildProfileModel(snapshot), html = profileReportHtml(model);
  const pdf = await renderReportPdf(html, { version: snapshot.version, generatedAt: snapshot.generatedAt, maxPages: snapshot.plan.frequency === "daily" ? 2 : 5 });
  const xlsx = await profileWorkbook(model);
  const { frequency, period, profile, access } = snapshot.plan;
  const name = `Goodwill-${frequency === "daily" ? "Daily" : "Monthly"}-${period}-${profile.id}${access.scope.kind === "channel" ? "-" + access.scope.channel : ""}`;
  return { model, html, pdf, xlsx, pdfName: `${name}-Report.pdf`, xlsxName: `${name}-Data.xlsx`, packageVersion: digest({ data: snapshot.version, plan: snapshot.plan.signature, template: "approved-template-profiles-v2" }) };
}

/** Server integration seam. The caller supplies authority from a verified session,
 * never from a profile query parameter. Currently demo-only grants are accepted.
 */
export async function prepareProfileDownload(resolvePlan: () => Promise<ReportPlan | null>, read: ViewReader): Promise<ProfilePackage> {
  const plan = await resolvePlan();
  if (!plan) throw new Error("A server-authorized report plan is required");
  return exportProfilePackage(await collectProfileSnapshot(plan, read));
}
