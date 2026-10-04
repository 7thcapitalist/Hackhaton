import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { PDFDocument } from "pdf-lib";
import { existsSync } from "node:fs";
import type { MonthlyData } from "./monthly-data";
import { escapeHtml, monthlyReportHtml } from "./monthly";

export async function monthlyReportPdf(data: MonthlyData): Promise<Uint8Array> {
  return renderReportPdf(monthlyReportHtml(data), { version: data.version, generatedAt: data.generatedAt, maxPages: 5 });
}

/** Shared real-PDF renderer; Daily and Monthly keep the approved print template. */
export async function renderReportPdf(html: string, data: { version: string; generatedAt: string; maxPages: number }): Promise<Uint8Array> {
  const local = process.platform === "win32" ? [
    `${process.env.PROGRAMFILES ?? "C:/Program Files"}/Google/Chrome/Application/chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)"}/Microsoft/Edge/Application/msedge.exe`,
  ].find(path => existsSync(path)) : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined;
  const executablePath = local ?? await chromium.executablePath();
  const browser = await puppeteer.launch({ executablePath, args: local ? [] : chromium.args, headless: local ? true : "shell" });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", request => { if (request.url().startsWith("data:") || request.url() === "about:blank") void request.continue(); else void request.abort(); });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    const footerTemplate = `<div style="width:100%;font:10px Arial;color:#4b535a;padding:0 13mm"><div>Prototype | Mission Control | Data version ${data.version}<span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div><div>Generated ${escapeHtml(data.generatedAt)} (UTC). Details and definitions: matching Excel.</div></div>`;
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate, tagged: true });
    const count = (await PDFDocument.load(pdf)).getPageCount();
    if (count > data.maxPages) throw new Error(`Report exceeds its ${data.maxPages}-page limit (${count} pages). Adjust layout before exporting.`);
    return pdf;
  } finally { await browser.close(); }
}
