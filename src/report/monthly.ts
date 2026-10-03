import { centsText } from "../export/csv";
import { kpiDisplay, kpiDisplayUnit } from "../export/scorecard";
import type { ReportCell, ScorecardExportData } from "../export/types";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;" })[char]!);
}
function display(value: ReportCell): string {
  return escapeHtml(value === null ? "awaiting data" : typeof value === "object" ? value.numeric : String(value));
}

// Standalone print-friendly output; Gabriel can consume the same view without
// changes to his pages. Values/previous/targets are supplied, never calculated.
export function monthlyReportHtml(view: ScorecardExportData): string {
  const simulated = view.kpis.some(kpi => kpi.status === "simulated");
  const awaiting = view.kpis.length === 0 || view.kpis.some(kpi => kpi.value === null || kpi.status === "awaiting_data") ||
    view.categories.length === 0 || view.marketplaceMetrics.length === 0;
  const cards = (kpis: ScorecardExportData["kpis"]) => kpis.map(kpi => `<article class="card" data-kpi-group="${escapeHtml(kpi.group)}">
    <div class="pill">${escapeHtml(kpi.pillar)}${kpi.anchor2027 ? " · 2027 priority" : ""}</div>
    <h2>${escapeHtml(kpi.label)}</h2><div class="value">${display(kpiDisplay(kpi.value, kpi.unit))}</div>
    <div class="unit">${escapeHtml(kpiDisplayUnit(kpi.unit))}</div>
    <div class="comparison">Previous: ${display(kpiDisplay(kpi.previous, kpi.unit))} · Target: ${display(kpiDisplay(kpi.target, kpi.unit))}</div>
    <div class="status">${escapeHtml(kpi.status)}</div>${kpi.note ? `<p class="note">${escapeHtml(kpi.note)}</p>` : ""}</article>`).join("");
  function kpiSection(group: "coo15" | "extended", title: string): string {
    return `<section class="kpi-section"><h2 class="section-title">${title}</h2><div class="grid">${
      cards(view.kpis.filter(kpi => kpi.group === group)) || "<p>Awaiting KPI data.</p>"}</div></section>`;
  }
  function categories(title: string, rows: { category: string; amount: number }[]) {
    return `<section><h2>${title}</h2><table><thead><tr><th>Category</th><th>Amount (currency units)</th></tr></thead><tbody>${rows.length
      ? rows.map(row => `<tr><td>${escapeHtml(row.category)}</td><td>${centsText(row.amount)}</td></tr>`).join("")
      : '<tr><td colspan="2">Awaiting data</td></tr>'}</tbody></table></section>`;
  }
  const categoryDetail = `<section class="detail"><h2 class="section-title">All category performance</h2>
    <p class="context">Sell-through uses synthetic item data. Amounts are in currency units; missing values indicate unavailable data.</p>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th>Revenue</th><th>Margin</th><th>Units</th><th>Sell-through (%)</th><th>Average selling price</th></tr></thead><tbody>${view.categories.length
      ? view.categories.map(row => `<tr><td>${escapeHtml(row.category)}</td><td>${centsText(row.revenueCents)}</td><td>${centsText(row.marginCents)}</td><td>${display(row.units)}</td><td>${display(row.sellThroughPct)}</td><td>${display(kpiDisplay(row.aspCents, "cents"))}</td></tr>`).join("")
      : '<tr><td colspan="6">Awaiting data</td></tr>'}</tbody></table></div></section>`;
  const marketplaceMetrics = `<section class="detail"><h2 class="section-title">Marketplace metrics</h2>
    <p class="context">CSAT and seller rating retain each marketplace's scale. NPS ranges from −100 to 100; conversion is expressed as a percentage.</p>
    <div class="table-wrap"><table><thead><tr><th>Channel</th><th>CSAT</th><th>NPS</th><th>Conversion (%)</th><th>Seller rating</th></tr></thead><tbody>${view.marketplaceMetrics.length
      ? view.marketplaceMetrics.map(row => `<tr><td>${escapeHtml(row.channel)}</td><td>${display(row.csat)}</td><td>${display(row.nps)}</td><td>${display(row.conversionRate)}</td><td>${display(row.sellerRating)}</td></tr>`).join("")
      : '<tr><td colspan="5">Awaiting data</td></tr>'}</tbody></table></div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
    <title>Goodwill monthly scorecard · ${escapeHtml(view.period)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#eef2f5;color:#18354a;font:14px Arial,sans-serif;overflow-wrap:anywhere}
      main{max-width:1000px;margin:28px auto;background:white;padding:30px;border:1px solid #dbe3e8}
      header{border-bottom:2px solid #18354a;padding-bottom:14px;margin-bottom:18px}h1{font-size:26px;margin:6px 0}
      h2{font-size:13px;margin:6px 0;font-weight:700}.eyebrow,.pill{font-size:10px;text-transform:uppercase;letter-spacing:.7px}
      .badges{display:flex;gap:8px;flex-wrap:wrap}.badge{background:#fff0c9;padding:5px 9px;border-radius:3px;font-size:12px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{border:1px solid #dbe3e8;padding:12px;break-inside:avoid}
      .value{font-size:23px;font-weight:700;margin:5px 0}.unit,.comparison,.status,.note{font-size:11px;line-height:1.4}
      .status{margin-top:5px;color:#536571}.note{margin:5px 0 0}.categories{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
      .kpi-section,.detail{margin-top:22px}.section-title{font-size:17px;margin-bottom:10px}.context{font-size:11px;line-height:1.5;color:#536571}.table-wrap{overflow-x:auto}
      table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:5px;border-bottom:1px solid #e4e9ed}td:last-child,th:last-child{text-align:right}
      footer{font-size:11px;line-height:1.5;color:#536571;border-top:1px solid #dbe3e8;margin-top:20px;padding-top:10px}
      @media(max-width:600px){main{margin:0;padding:16px}.grid,.categories{grid-template-columns:1fr}}
      @page{size:letter;margin:12mm}@media print{body{background:white}main{border:0;margin:0;padding:0;max-width:none}.grid{gap:7px}.card{padding:8px}.value{font-size:19px}.categories{margin-top:12px}th,td{padding:3px}footer{margin-top:12px}header{margin-bottom:12px}h1{font-size:22px}}
    </style></head><body><main><header><div class="eyebrow">Mission Control · Goodwill Michiana</div>
    <h1>Monthly COO scorecard</h1><p>Reporting period: <strong>${escapeHtml(view.period)}</strong></p>
    <div class="badges">${simulated ? '<span class="badge">Contains simulated indicators</span>' : ""}${awaiting ? '<span class="badge">Some data is unavailable</span>' : ""}</div></header>
    <p class="context">Dataset provenance is unavailable from the shared scorecard. An “ok” status means an indicator is computable; it does not certify real data.</p>
    ${kpiSection("coo15", "COO scorecard — 15 core indicators")}
    ${kpiSection("extended", "Extended indicators")}<div class="categories">
    ${categories("Categories by revenue", view.topCategoriesByRevenue.map(row => ({ category: row.category, amount: row.revenueCents })))}
    ${categories("Categories by margin", view.topCategoriesByMargin.map(row => ({ category: row.category, amount: row.marginCents })))}</div>
    ${categoryDetail}${marketplaceMetrics}
    <footer>Values, previous period, targets, categories and statuses are supplied by the shared scorecard view. No figures are invented or recalculated here.<br>
    Money is shown in the view's reporting currency; no currency conversion is performed. Percent values are percentage points (2.4 = 2.4%).<br>
    This is a management report, not a Business Central journal or AR invoice. Use your browser's Print command to print or save as PDF.</footer>
    </main></body></html>`;
}
