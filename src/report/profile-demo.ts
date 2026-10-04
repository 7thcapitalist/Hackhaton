import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { authorizeReport, demoAccess, reportProfiles, type Frequency } from "./profiles";
import { collectProfileSnapshot, profileDemoApi } from "./profile-source";
import { exportProfilePackage } from "../export/profile";
import { profileEmailPreview } from "../emails/profile-preview";
import { escapeHtml as e } from "./monthly";
import { goodwillLogo } from "./monthly-brand";

/** Explicit, read-only demo CLI. It never pulls sources, changes the database or sends. */
async function main() {
  const [origin, output, dailyDate, monthlyPeriod, acknowledgement, selected = "finance,coo,director,channel,ceo"] = process.argv.slice(2);
  if (!origin || !output || !dailyDate || !monthlyPeriod || acknowledgement !== "--synthetic-demo") throw new Error("Usage: tsx src/report/profile-demo.ts <known-demo-origin> <output-directory> <daily-date> <monthly-period> --synthetic-demo [finance,coo,director,channel,ceo]");
  const root = path.resolve(output), profiles = selected.split(",");
  const summary: { id: string; label: string; frequency: Frequency; period: string; scope: string; folder: string; pdf: string; xlsx: string; pages: number; version: string; records: number; sheets: { name: string; records: number }[]; emailBytes: number }[] = [];
  await mkdir(root, { recursive: true });
  for (const id of profiles) {
    if (!reportProfiles[id] || !demoAccess[id]) throw new Error("Unknown demonstration profile");
    for (const frequency of ["daily", "monthly"] as Frequency[]) {
      const period = frequency === "daily" ? dailyDate : monthlyPeriod;
      const plan = authorizeReport(reportProfiles[id], demoAccess[id], frequency, period);
      console.log(`Collecting ${id} ${frequency} ${period}`);
      const snapshot = await collectProfileSnapshot(plan, profileDemoApi(origin));
      const pack = await exportProfilePackage(snapshot), email = profileEmailPreview(pack);
      const folder = `${id}/${frequency}`, destination = path.join(root, folder);
      await mkdir(destination, { recursive: true });
      for (const [name, content] of [[pack.pdfName, pack.pdf], [pack.xlsxName, pack.xlsx], ["Email-Preview.html", email.html], ["Dashboard-Preview.html", pack.html.replace("<main class=", '<p style="margin:20px;text-align:center;font:14px Arial">Local scoped report preview — employee dashboard authentication is pending.</p><main class=')], ["Report-Preview.html", pack.html]] as const) await writeFile(path.join(destination, name), content);
      // QA inputs contain the allowlisted view fields only, never buyer or archive data.
      await writeFile(path.join(destination, "QA-snapshot.json"), JSON.stringify(snapshot));
      const pages = (await PDFDocument.load(pack.pdf)).getPageCount();
      const entry = { id, label: plan.profile.label, frequency, period, scope: pack.model.scopeLabel, folder, pdf: pack.pdfName, xlsx: pack.xlsxName, pages, version: snapshot.version, records: snapshot.orders.length, sheets: pack.model.sheets.map(t => ({ name: t.name, records: t.rows.length })), emailBytes: email.encodedBytes };
      summary.push(entry); console.log(JSON.stringify(entry));
    }
  }
  await writeFile(path.join(root, "QA-manifest.json"), JSON.stringify(summary, null, 2));
  const cards = profiles.map(id => `<section><h2>${e(reportProfiles[id].label)}</h2><p>${e(reportProfiles[id].purpose.monthly)}</p>${summary.filter(s => s.id === id).map(s => `<article><h3>${s.frequency === "daily" ? "Daily" : "Monthly"} · ${e(s.period)}</h3><p>${e(s.scope)} · ${s.pages} PDF page${s.pages === 1 ? "" : "s"}</p><nav><a href="${s.folder}/${s.pdf}">PDF</a><a href="${s.folder}/${s.xlsx}">Excel</a><a href="${s.folder}/Email-Preview.html">Email preview</a><a href="${s.folder}/Dashboard-Preview.html">Scoped preview</a></nav></article>`).join("")}</section>`).join("");
  await writeFile(path.join(root, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goodwill report review</title><style>body{font:16px/1.5 Arial;background:#ecf1f5;color:#232020;margin:0}main{max-width:1100px;margin:24px auto;padding:32px;background:white}header{display:flex;gap:20px;align-items:center;border-bottom:3px solid #01539c}header img{width:46px;height:auto}h1,h2,h3,a{color:#01539c}h1{font-size:26px}h2{font-size:21px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{border-top:2px solid #01539c;padding-top:10px}article{border-top:1px solid #cdd9e3;padding:8px 0}nav{display:flex;gap:12px;flex-wrap:wrap}a{font-weight:bold}aside{padding:15px;background:#f5f7fa;margin:22px 0;font-size:14px}@media(max-width:700px){.grid{grid-template-columns:1fr}main{margin:0;padding:18px}}</style></head><body><main><header><img src="${goodwillLogo}" alt="Official Goodwill logo"><div><h1>Daily and monthly report review</h1><p>Goodwill Michiana · Mission Control prototype</p></div></header><aside><strong>${profiles.length === 1 && profiles[0] === "ceo" ? "CEO demonstration: daily and monthly." : "Choose a profile and reporting period below."}</strong> The PDF explains the results; the Excel provides the supporting data. All profiles are hypotheses, all samples are synthetic, and no email has been sent. The approved PDF and Excel templates are reused.</aside><div class="grid">${cards}</div><aside><strong>Before real use:</strong> Amanda/João must confirm roles, recipients, scope and targets. João/Gabriel must integrate verified employee authorization and scope-correct dashboard links. Local previews do not provide an employee security boundary.</aside></main></body></html>`);
  console.log(`Review index: ${path.join(root, "index.html")}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Demo generation failed"); process.exitCode = 1; });
