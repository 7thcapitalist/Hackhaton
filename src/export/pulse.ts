import { moneyCell, tableToCsv } from "./csv";
import type { PulseExportData, ReportTable } from "./types";

export function pulseTable(view: PulseExportData): ReportTable {
  const partial = view.missingChannels.length > 0 || view.rows.some(row =>
    row.status === "missing" || row.revenueCents === null || row.customers === null || row.orders === null);
  const metadata = [view.isSynthetic, partial ? "partial" : "complete", view.missingChannels.join(" | ")];
  return {
    name: "Daily Pulse",
    columns: ["record_type", "business_date", "timezone", "channel_id", "marketplace",
      "status", "revenue_cents", "revenue", "customers", "orders", "is_synthetic",
      "report_status", "missing_channels"],
    rows: [
      ...view.rows.map(row => ["channel", view.businessDate, view.timezone,
        row.channelId, row.label, row.status, row.revenueCents,
        row.revenueCents === null ? "missing" : moneyCell(row.revenueCents),
        row.customers, row.orders, ...metadata]),
      ["total", view.businessDate, view.timezone, "", "Total e-commerce",
        partial ? "partial" : "ok", view.totals.revenueCents, moneyCell(view.totals.revenueCents),
        view.totals.customers, view.totals.orders, ...metadata],
    ],
  };
}

export function pulseCsv(view: PulseExportData): string {
  return tableToCsv(pulseTable(view));
}
