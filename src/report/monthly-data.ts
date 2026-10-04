import { createHash } from "node:crypto";
import type { ScorecardExportData } from "../export/types";
import type { OrdersView, IngestRunRow, SourceStatus } from "../lib/views/types";
import { previousPeriod } from "../lib/views/dates";
import { formatReportValue, kpiMeaning, monthName, type ReportKpi } from "./monthly-content";
import { validBusinessDate } from "../export/validation";

/** An order line as the report keeps it: no buyer identifiers or supplier (excluded on purpose). */
export type MonthlyOrder = Omit<OrdersView["rows"][number], "buyerKey" | "supplier" | "currency"> & { currency?: string };
/** A source file as the report keeps it: no archive keys or signed download links (they expire). */
export type MonthlyFile = Omit<IngestRunRow, "archiveKey" | "archiveUrl" | "archiveBackend" | "archiveDownloadPath">;
export type MonthlySource = Omit<SourceStatus, "status" | "cadence" | "missingDates"> & {
  status: SourceStatus["status"] | "not_due";
  cadence?: "daily" | "weekly" | "monthly";
  missingDates?: string[];
};
export interface MonthlyData {
  scorecard: ScorecardExportData;
  orders: MonthlyOrder[] | null;
  files: MonthlyFile[];
  sources: MonthlySource[];
  sourceAsOf?: string;
  currency: "USD" | null;
  currencyConfirmation: string;
  targetBasis: "illustrative" | "unconfirmed" | "approved";
  generatedAt: string;
  version: string;
  collection: "shared-views" | "supplied-snapshot";
}
type Options = Partial<Omit<MonthlyData, "scorecard" | "version">>;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** One immutable input for both documents. The hash excludes generation time. */
export function monthlyData(scorecard: ScorecardExportData, options: Options = {}): MonthlyData {
  const data = structuredClone({ scorecard, orders: null, files: [], sources: [], currency: null,
    currencyConfirmation: "Currency is not confirmed in this snapshot.", targetBasis: "unconfirmed",
    generatedAt: new Date().toISOString(), collection: "supplied-snapshot", ...options }) as Omit<MonthlyData, "version">;
  if (!Number.isFinite(Date.parse(data.generatedAt))) throw new Error("Invalid generation time");
  if (data.sourceAsOf && !validBusinessDate(data.sourceAsOf)) throw new Error("Invalid source availability date");
  if (data.orders) {
    const ids = new Set<string>();
    for (const row of data.orders) {
      if (!validBusinessDate(row.businessDate) || !row.businessDate.startsWith(scorecard.period + "-") || ids.has(row.id) ||
        !Number.isSafeInteger(row.grossCents) || !Number.isSafeInteger(row.netCents)) throw new Error("Invalid or duplicate monthly order line");
      ids.add(row.id);
    }
  }
  const { generatedAt: _time, ...content } = data;
  const version = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  return freeze({ ...data, version });
}
export function asMonthlyData(input: MonthlyData | ScorecardExportData): MonthlyData {
  return "scorecard" in input ? input : monthlyData(input);
}
export function moneyUnit(data: MonthlyData): string { return data.currency ?? "Amount"; }
export function detailAvailability(data: MonthlyData): string {
  if (data.orders === null) return data.files.length || data.sources.length
    ? "Detailed order lines were not supplied. Source references are available in Excel."
    : "Aggregate-only snapshot: detailed order lines and file references were not supplied.";
  return data.orders.length ? `${formatReportValue(data.orders.length, "count")} normalized order lines are available in Excel.` : "No order lines were returned for this period.";
}
export function originLabel(data: MonthlyData): string {
  const simulatedMeasures = data.scorecard.kpis.some(kpi => kpi.status === "simulated");
  const operatingNote = simulatedMeasures ? " Some operating measures use simulated inputs." : "";
  if (!data.files.length) return simulatedMeasures ? "Record origin unconfirmed; some operating measures use simulated inputs." : "Record origin unconfirmed.";
  const linked = new Set(data.orders?.map(row => row.ingestRunId) ?? []);
  const orderFiles = data.files.filter(file => linked.has(file.id));
  const unknown = [...linked].some(id => !data.files.some(file => file.id === id));
  if (unknown || !orderFiles.length) return "Some record origins are unconfirmed; see Sources." + operatingNote;
  if (orderFiles.every(file => file.isSynthetic)) return "Simulated source records; these are demonstration results, not actual Goodwill performance.";
  if (orderFiles.some(file => file.isSynthetic)) return "Mixed simulated and other source records; see Sources.";
  return "Source files are not marked synthetic; authenticity has not been independently verified." + operatingNote;
}
export function targetLabel(data: MonthlyData): string {
  return data.targetBasis === "illustrative" ? "Illustrative targets" : data.targetBasis === "approved" ? "Targets" : "Unconfirmed targets";
}
export interface PresentationChange { measure: string; current: number | null; previous: number | null; change: number | null; unit: string; calculation: string; comment: string }
export function presentationChanges(data: MonthlyData): PresentationChange[] {
  const prior = monthName(previousPeriod(data.scorecard.period));
  return ["total_revenue", "net_margin_pct", "revenue_per_labor_hour", "sell_through_rate", "listings_created", "unlisted_backlog", "unsold_inventory_pct"]
    .map(id => data.scorecard.kpis.find(kpi => kpi.id === id)).filter((kpi): kpi is ReportKpi => !!kpi)
    .map(kpi => {
      const available = kpi.value !== null && kpi.previous !== null;
      const rawChange = available ? kpi.value! - kpi.previous! : null;
      const change = rawChange === null ? null : Number(rawChange.toFixed(10));
      const unit = kpi.unit === "percent" ? Math.abs(change ?? 0) === 1 ? "percentage point" : "percentage points" : kpi.unit === "cents_per_hour" ? `${moneyUnit(data)} per hour` : kpi.unit === "cents" ? moneyUnit(data) : kpiMeaning(kpi).unit ?? "recorded units";
      const label = kpiMeaning(kpi).name;
      const amount = change === null ? "" : formatReportValue(Math.abs(change), kpi.unit === "percent" ? "ratio" : kpi.unit);
      return { measure: label, current: kpi.value, previous: kpi.previous, change, unit,
        calculation: "Current source value minus previous source value; money is stored in cents. No business KPI is recalculated.",
        comment: change === null ? `${label}: comparison with ${prior} is unavailable.` : change === 0 ? `${label} was unchanged from ${prior}.` :
          `${label} ${change > 0 ? "increased" : "decreased"} by ${amount} ${unit} from ${prior}.` };
    });
}
export function friendlyNote(note = ""): string {
  return note.replace(/LABOR_RATE_CENTS_PER_HOUR/g, "assumed hourly labor cost")
    .replace(/categories\[\]/g, "Categories worksheet").replace(/marketplaceMetrics\[\]/g, "Marketplaces worksheet")
    .replace(/topCategoriesByRevenue/g, "Categories: revenue ranking").replace(/topCategoriesByMargin/g, "Categories: margin ranking")
    .replace(/CATEGORY_CUSTOMER/g, "Categories & customers");
}
