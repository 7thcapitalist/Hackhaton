import type { ScorecardExportData } from "../export/types";
import { previousPeriod } from "../lib/views/dates";
import { dataLabel, formatReportNumber, formatReportValue, growthBasis, kpiMeaning, monthName, pillarNames, type ReportKpi } from "./monthly-content";
import { goodwillLogo } from "./monthly-brand";
import { monthlyStyles } from "./monthly-style";
import { asMonthlyData, detailAvailability, moneyUnit, originLabel, presentationChanges, targetLabel, type MonthlyData } from "./monthly-data";
import { bars, revenueChart } from "./monthly-charts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
const text = escapeHtml;
export function monthlyReportHtml(input: MonthlyData | ScorecardExportData): string {
  const data = asMonthlyData(input), view = data.scorecard;
  const period = monthName(view.period), prior = monthName(previousPeriod(view.period));
  const unit = moneyUnit(data), targets = targetLabel(data);
  const find = (id: string) => view.kpis.find(k => k.id === id);
  const amount = (value: number | null) => text(formatReportValue(value, "cents"));
  const value = (k: ReportKpi, v = k.value) => text(formatReportValue(v, k.unit)) + (v !== null && k.unit === "days" ? " days" : "");
  const changes = presentationChanges(data), revenue = find("total_revenue"), growth = find("revenue_growth_pct"), margin = find("net_margin_pct");
  const summary = changes.filter(row => ["Online sales revenue", "Estimated net margin", "Share of available items sold"].includes(row.measure));
  const core = view.kpis.filter(k => k.group === "coo15");
  const priorityDescriptions: Record<string, string> = {
    net_margin_pct: margin ? `${kpiMeaning(margin).meaning} Overhead excluded; not final profit.` : "",
    revenue_per_labor_hour: "Online revenue divided by recorded work hours. This measures productivity, not profit per hour.",
    sell_through_rate: "Items sold this month as a share of items available for sale.",
  };
  const pageTitles = ["How was the month?", "What changed?", "The 15 core indicators"];
  function header(page: number): string {
    return `<header class="page-heading"><img class="brand-logo" src="${goodwillLogo}" width="115.6" height="160.6" alt="Official Goodwill logo"><div><p class="organization">Goodwill Industries of Michiana, Inc.</p><h${page === 1 ? "1" : "2"}>${page === 1 ? "Monthly performance report" : pageTitles[page - 1]}</h${page === 1 ? "1" : "2"}><p class="period">${text(period)} &middot; E-commerce</p></div><span class="page-number">${page} / 3</span></header>`;
  }
  function footer(): string { return `<footer>Prototype &middot; Mission Control &middot; ${text(unit)} &middot; Data version ${data.version}<br>Generated ${text(data.generatedAt)} (UTC). See the matching Excel for definitions and available detail.</footer>`; }
  const priorities = view.kpis.filter(k => k.anchor2027).map(k => `<article class="priority"><div><h4>${text(kpiMeaning(k).name)} <span class="technical">${text(k.label)}</span></h4><p>${text(priorityDescriptions[k.id] ?? kpiMeaning(k).meaning)}</p></div><div class="priority-result"><span class="number">${value(k)}</span><span class="measure-unit">${k.unit === "cents_per_hour" ? text(unit) + " per hour" : ""}</span><span class="comparison">${text(prior)}: ${value(k, k.previous)}</span><span class="target">${text(targets)}: ${k.target === null ? "Not set" : value(k, k.target)}</span><span class="data-label">${text(dataLabel(k))}</span></div></article>`).join("");
  const categoryTotal = view.categories.reduce((sum, row) => sum + row.revenueCents, 0);
  const categoryGap = revenue?.value == null ? null : revenue.value - categoryTotal;
  const categoryChart = bars("Which categories contributed the most revenue?", view.topCategoriesByRevenue.map(row => ({ label: row.category, value: row.revenueCents, display: formatReportValue(row.revenueCents, "cents") })), 6);
  const leading = view.topCategoriesByRevenue[0];
  const operational = changes.filter(row => ["New listings created", "Items waiting to be listed", "Unsold listings older than 60 days"].includes(row.measure));
  const unavailable = view.kpis.filter(k => k.value === null).length;
  const coverage = [...new Set(view.kpis.flatMap(k => [...(k.note ?? "").matchAll(/Partial month: data through (\d{4}-\d{2}-\d{2})/g)].map(m => m[1])))];
  const laborRate = view.kpis.flatMap(k => [...(k.note ?? "").matchAll(/Processing labor cost = labor hours [\u00d7x] \$([\d,.]+)\/h loaded rate/g)].map(m => m[1]))[0];
  const buyers = view.kpis.flatMap(k => [...(k.note ?? "").matchAll(/(\d+) transactions without a buyer id/g)].map(m => Number(m[1])))[0];
  const rows = Object.keys(pillarNames).map(pillar => {
    const members = core.filter(k => k.pillar === pillar);
    return members.length ? `<tr class="group-heading"><th colspan="5">${text(pillarNames[pillar as ReportKpi["pillar"]])}</th></tr>${members.map(k => {
      const labels: Record<string, string> = { revenue_per_labor_hour: "Revenue per labor hour", listings_per_employee: "Listings per employee", days_donation_to_listing: "Donation to listing", avg_selling_price: "Average price per item", sell_through_rate: "Share of available items sold", sales_per_employee: "Revenue per employee", top10_categories_revenue: "Top 10 categories: revenue", top10_categories_margin: "Top 10 categories: margin amount", repeat_buyer_rate: "Buyers with repeat purchases" };
      const label = labels[k.id] ?? kpiMeaning(k).name;
      const financialUnit = k.unit === "cents_per_hour" ? `${unit}/hour` : k.unit === "cents" ? k.id === "sales_per_employee" ? `${unit}/employee` : unit : k.unit === "count" || k.unit === "ratio" ? kpiMeaning(k).unit ?? "count / ratio" : "";
      return `<tr data-kpi-group="coo15" data-kpi-id="${text(k.id)}"><th scope="row">${text(label)}${k.anchor2027 ? " *" : ""}${financialUnit ? ` <small>(${text(financialUnit)})</small>` : ""}</th><td class="numeric">${value(k)}</td><td class="numeric">${value(k, k.previous)}</td><td class="numeric">${k.target === null ? "Not set" : value(k, k.target)}</td><td class="data-label">${text(dataLabel(k).replace(" inputs", "").replace("Data ", ""))}</td></tr>`;
    }).join("")}` : "";
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'"><title>Goodwill monthly report - ${text(period)}</title><style>${monthlyStyles}</style></head><body><main>
  <section class="report-page" id="monthly-overview">${header(1)}<p class="eyebrow">${pageTitles[0]}</p>
  <div class="revenue-summary"><article><h3>Online sales revenue</h3><span class="number">${amount(revenue?.value ?? null)}</span><span class="measure-unit">${text(unit)}</span><p>Sales and shipping collected, after fees and refunds. Tax is excluded. Revenue is not profit.</p></article><article class="summary"><h3>Observed in the supplied data</h3><ul>${summary.map(row => `<li>${text(row.comment)}</li>`).join("") || "<li>Monthly comparisons are unavailable.</li>"}</ul></article></div>
  <h3>Revenue: this month versus last month</h3>${revenueChart(data)}<p class="caption-note">Two supplied report periods; the chart begins at zero. ${growth ? `<strong>Separate comparison:</strong> ${value(growth)}. ${text(growthBasis(growth, previousPeriod(view.period)))}.` : "Annual comparison is unavailable."}</p>
  <section class="priorities"><h3>Three priorities for 2027</h3>${priorities || "<p>Priority data is unavailable.</p>"}</section>
  <aside class="quality-note"><strong>Prototype &mdash; review before use.</strong> ${text(originLabel(data))} ${text(detailAvailability(data))} ${data.targetBasis !== "approved" ? "Targets have not been approved by Goodwill." : ""} ${data.currency ? "" : "Currency is unconfirmed; no symbol is used."} ${coverage.length ? `Incomplete month: recorded sales through ${text(coverage.join(", "))}.` : ""} ${unavailable ? `${unavailable} indicators are unavailable; blanks are not zero.` : ""}</aside>${footer()}</section>
  <section class="report-page" id="changes">${header(2)}<h3>Which categories generated the most revenue?</h3>${view.topCategoriesByRevenue.length ? categoryChart : "<p>Category rankings are unavailable.</p>"}
  <p class="caption-note">${leading ? `${text(leading.category)} leads the supplied ranking at ${amount(leading.revenueCents)} ${text(unit)}. ` : ""}${Math.min(6, view.topCategoriesByRevenue.length)} leading entries are shown; all ${view.topCategoriesByRevenue.length} ranked entries and all ${view.categories.length} categories are in Excel.</p>
  ${view.categories.length ? `<aside class="coverage"><h4>Category revenue has a different scope</h4><p>All categorized orders total <strong>${amount(categoryTotal)} ${text(unit)}</strong>${categoryGap === null ? "." : categoryGap === 0 ? "; this matches the supplied total online revenue." : `; this is ${amount(Math.abs(categoryGap))} ${text(unit)} ${categoryGap > 0 ? "below" : "above"} total online revenue.`} The shared category calculation includes orders with a category. These amounts compare data coverage, not months.</p></aside>` : "<p>Category detail is not supplied; coverage cannot be confirmed.</p>"}
  <h3>Changes in listing and inventory flow</h3><div class="changes-list">${operational.map(row => `<article><h4>${text(row.measure)}</h4><p>${text(row.comment)} </p></article>`).join("") || "<p>Operating comparisons are unavailable.</p>"}</div>
  <p class="next-section">These changes do not establish causes. Operating measures use simulated inputs where marked. Full rankings and available data are in the matching Excel.</p>${footer()}</section>
  <section class="report-page" id="full-scorecard">${header(3)}<p class="caption-note">* = 2027 priority (already highlighted on page 1). ${text(targets)} are shown as supplied. Higher is not always better.</p>
  <table class="kpi-table"><colgroup><col style="width:43%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:15%"></colgroup><thead><tr><th>Measure / unit</th><th class="numeric">${text(period)}</th><th class="numeric">${text(prior)}<br>report value</th><th class="numeric">Target</th><th>Data</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Core indicators are unavailable.</td></tr>'}</tbody></table>
  <p class="legend">Calculated = computable from supplied records, not proof of real data or good performance. Simulated = synthetic inputs. Unavailable = missing, not zero. Not set = no target.</p>
  <section class="notes"><h3>Essential reading notes</h3><ul><li><strong>Estimated margin:</strong> ${laborRate ? `labor assumes ${text(laborRate)} ${text(unit)}/hour. ` : "The hourly labor assumption is not supplied. "}General overhead is excluded; this is not final profit.</li><li><strong>Category margin:</strong> category revenue less customer shipping charges. It differs from overall estimated margin; rankings are in Excel.</li><li><strong>Buyers:</strong> identified within each marketplace; orders are not unique people. ${buyers === undefined ? "Coverage is described in Excel." : `${formatReportNumber(buyers)} transactions without buyer identification are excluded.`}</li><li><strong>Comparison periods:</strong> ${growth ? text(growthBasis(growth, previousPeriod(view.period))) + "." : "Revenue growth reference is unavailable."} The previous growth rate's reference period is not supplied.</li></ul></section>${footer()}</section></main></body></html>`;
}
