import type { PulseExportData, ScorecardExportData, KpiUnit } from "./types";
import { isValidDate as validBusinessDate, isValidPeriod as validPeriod } from "@/lib/views/dates";
export { validBusinessDate, validPeriod };

export class ReportError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function invalid(): never {
  throw new ReportError(502, "invalid_view_data", "The shared view returned invalid report data.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
function number(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) ||
    (integer && !Number.isSafeInteger(value))) invalid();
  return value;
}
function nullable(value: unknown, integer = false): number | null {
  return value === null ? null : number(value, integer);
}
function count(value: unknown): number {
  const result = number(value, true);
  if (result < 0) invalid();
  return result;
}
function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10000) invalid();
  return value;
}

export function parsePulse(value: unknown, expectedDate: string): PulseExportData {
  const data = object(value);
  const businessDate = text(data.businessDate);
  if (!validBusinessDate(businessDate) || businessDate !== expectedDate ||
    data.timezone !== "America/Indiana/Indianapolis") invalid();
  const totals = object(data.totals);
  const rows = list(data.rows).map(value => {
    const row = object(value);
    if (row.status !== "ok" && row.status !== "missing") invalid();
    const result: PulseExportData["rows"][number] = { channelId: text(row.channelId) as PulseExportData["rows"][number]["channelId"], label: text(row.label),
      status: row.status, revenueCents: nullable(row.revenueCents, true),
      customers: nullableCount(row.customers), orders: nullableCount(row.orders) };
    if (result.status === "missing" &&
      [result.revenueCents, result.customers, result.orders].some(v => v !== null)) invalid();
    return result;
  });
  return { businessDate, timezone: data.timezone, rows,
    totals: { revenueCents: number(totals.revenueCents, true), customers: count(totals.customers),
      orders: count(totals.orders) },
    missingChannels: list(data.missingChannels).map(value => text(value) as PulseExportData["missingChannels"][number]), isSynthetic: bool(data.isSynthetic) };
}

export function parseScorecard(value: unknown, expectedPeriod: string): ScorecardExportData {
  const data = object(value);
  const period = text(data.period);
  if (!validPeriod(period) || period !== expectedPeriod) invalid();
  const units: KpiUnit[] = ["cents", "percent", "count", "days", "ratio", "cents_per_hour"];
  const kpis = list(data.kpis).map(value => {
    const row = object(value);
    if (!units.includes(row.unit as KpiUnit) ||
      !["ok", "simulated", "awaiting_data"].includes(String(row.status)) ||
      !["coo15", "extended"].includes(String(row.group))) invalid();
    return { id: text(row.id), label: text(row.label), pillar: text(row.pillar) as ScorecardExportData["kpis"][number]["pillar"],
      unit: row.unit as KpiUnit, value: nullable(row.value, row.unit === "cents"),
      previous: nullable(row.previous, row.unit === "cents"),
      target: nullable(row.target, row.unit === "cents"), status: row.status as "ok" | "simulated" | "awaiting_data",
      anchor2027: bool(row.anchor2027), group: row.group as "coo15" | "extended",
      ...(row.note === undefined ? {} : { note: text(row.note) }) };
  });
  function categories(value: unknown, field: "revenueCents" | "marginCents") {
    return list(value).map(value => {
      const row = object(value);
      return { category: text(row.category), [field]: number(row[field], true) };
    });
  }
  return { period, kpis,
    topCategoriesByRevenue: categories(data.topCategoriesByRevenue, "revenueCents") as ScorecardExportData["topCategoriesByRevenue"],
    topCategoriesByMargin: categories(data.topCategoriesByMargin, "marginCents") as ScorecardExportData["topCategoriesByMargin"],
    categories: list(data.categories).map(value => {
      const row = object(value);
      return { category: text(row.category), revenueCents: number(row.revenueCents, true),
        marginCents: number(row.marginCents, true), units: count(row.units),
        sellThroughPct: nullable(row.sellThroughPct), aspCents: nullable(row.aspCents, true) };
    }),
    marketplaceMetrics: list(data.marketplaceMetrics).map(value => {
      const row = object(value);
      return { channel: text(row.channel), csat: nullable(row.csat), nps: nullable(row.nps),
        conversionRate: nullable(row.conversionRate), sellerRating: nullable(row.sellerRating) };
    }) };
}
