import type { MonthlyData } from "./monthly-data";
import { formatReportValue, monthName } from "./monthly-content";
import { previousPeriod } from "../lib/views/dates";

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export interface Bar { label: string; value: number | null; display: string; color?: string }
export const marketplaceColors: Record<string,string> = { shopgoodwill: "#01529c", amazon: "#eea055", ebay: "#1d7a5c", other: "#9a958e", goodwill_books: "#9b5a7a" };
/** Zero baseline, negative values supported, missing values never drawn as zero. */
export function bars(title: string, rows: Bar[], maxRows = rows.length): string {
  const shown = rows.slice(0, maxRows);
  const rowHeight = Math.max(39, ...shown.map(row => Math.ceil(row.label.length / 28) * 16 + 10));
  const height = 32 + shown.length * rowHeight;
  const values = shown.flatMap(row => row.value === null ? [] : [row.value]);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const span = high - low || 1, start = 236, width = 335, zero = start + (-low / span) * width;
  return `<svg class="bar-chart" viewBox="0 0 750 ${height}" role="img" aria-label="${esc(title)}" xmlns="http://www.w3.org/2000/svg"><title>${esc(title)}</title>
    <line x1="${zero}" y1="10" x2="${zero}" y2="${height - 15}" stroke="#aab5be"/>
    ${shown.map((row, i) => {
      const y = 18 + i * rowHeight, x = row.value === null ? zero : start + ((Math.min(row.value, 0) - low) / span) * width;
      const labelChunks = row.label.match(/.{1,28}(?:\s|$)|.{1,28}/g) ?? [row.label];
      return `<text x="0" y="${y + 15}" font-size="14" fill="#0e1a28">${labelChunks.map((chunk, j) => `<tspan x="0" dy="${j ? 13 : 0}">${esc(chunk.trim())}</tspan>`).join("")}</text>
        ${row.value === null ? "" : `<rect x="${x}" y="${y}" width="${Math.abs(row.value) / span * width}" height="21" fill="${row.color && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : i === 0 ? "#01529c" : "#4c86c4"}"/>`}
        <text x="590" y="${y + 15}" font-size="14" fill="#0e1a28">${esc(row.display)}</text>`;
    }).join("")}<text x="${zero}" y="${height - 2}" font-size="12" fill="#4b535a">0</text></svg>`;
}
export function revenueChart(data: MonthlyData): string {
  const kpi = data.scorecard.kpis.find(row => row.id === "total_revenue");
  return bars("How does revenue compare with the previous month?", [
    { label: monthName(data.scorecard.period), value: kpi?.value ?? null, display: formatReportValue(kpi?.value ?? null, "cents") },
    { label: monthName(previousPeriod(data.scorecard.period)), value: kpi?.previous ?? null, display: formatReportValue(kpi?.previous ?? null, "cents") },
  ]);
}
