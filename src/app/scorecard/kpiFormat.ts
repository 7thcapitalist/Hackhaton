// Pure scorecard helpers: status, targets and changes that respect each KPI's better direction.
// No I/O, safe on server and client.
import { formatKpiShort, formatKpiValue } from "../_lib/format";
import type { Kpi } from "../_lib/types";

export const PILLARS: { id: Kpi["pillar"]; name: string }[] = [
  { id: "financial", name: "Financial" },
  { id: "productivity", name: "Productivity" },
  { id: "inventory", name: "Inventory" },
  { id: "sales", name: "Sales" },
  { id: "category_customer", name: "Category + customer" },
];

/** Within this share of the target (on the wrong side) counts as "near" rather than "off". */
export const NEAR_BAND = 0.05;

/** The Monthly report's three key cards, in order: revenue, orders, net margin. */
export const KEY_KPI_IDS = ["total_revenue", "total_orders", "net_margin_pct"] as const;

export type Status = "on" | "near" | "off" | "none" | "awaiting";
type Scored = Pick<Kpi, "value" | "target" | "higherIsBetter">;

const higher = (k: Pick<Kpi, "higherIsBetter">) => k.higherIsBetter !== false;

export function kpiStatus(k: Scored, nearBand = NEAR_BAND): Status {
  if (k.value == null) return "awaiting";
  if (k.target == null) return "none";
  if (k.target === 0) return (higher(k) ? k.value >= 0 : k.value <= 0) ? "on" : "off";
  const r = higher(k) ? k.value / k.target : k.target / k.value;
  return r >= 1 ? "on" : r >= 1 - nearBand ? "near" : "off";
}

/** Text labels go with every status (never color alone). */
export const STATUS_META: Record<Status, { label: string; short: string; icon: string; fg: string }> = {
  on: { label: "On track", short: "on track", icon: "✓", fg: "text-ok" },
  near: { label: "Near target", short: "near", icon: "◐", fg: "text-warn" },
  off: { label: "Off track", short: "off", icon: "✕", fg: "text-bad" },
  none: { label: "No target", short: "no target", icon: "–", fg: "text-ink-3" },
  awaiting: { label: "Awaiting data", short: "awaiting", icon: "○", fg: "text-ink-3" },
};

/** "≥ 55.0%", "≤ 12.0 days", "≤ 800"; "No target" when there is none. */
export function formatTarget(k: Pick<Kpi, "unit" | "target" | "higherIsBetter">): string {
  if (k.target == null) return "No target";
  return `${higher(k) ? "≥" : "≤"} ${formatKpiShort(k.unit, k.target)}`;
}

/** Value and its unit suffix, e.g. { value: "$69.87", suffix: "/ labor hr" }. */
export function formatValue(k: Pick<Kpi, "unit" | "value">): { value: string; suffix: string } | null {
  return k.value == null ? null : formatKpiValue(k.unit, k.value);
}

export type Change = { text: string; tone: "good" | "bad" | "flat"; spoken: string };

/**
 * Change vs the prior month, colored by the KPI's better direction. Percent KPIs move in
 * points, the rest in %. "flat" when it rounds to zero. Null when there is nothing to compare.
 */
export function kpiChange(k: Pick<Kpi, "unit" | "value" | "previous" | "higherIsBetter">): Change | null {
  const { unit, value, previous } = k;
  if (value == null || previous == null) return null;
  const d = value - previous;
  let amount: number, unitText: string;
  if (unit === "percent") { amount = d; unitText = " pts"; }
  else if (unit === "score") { amount = d; unitText = ""; } // CSAT / NPS move in their own units
  else if (previous === 0) return null;
  else { amount = (d / Math.abs(previous)) * 100; unitText = "%"; }
  const shown = Math.abs(amount).toFixed(unit === "score" ? 2 : 1);
  if (Number(shown) === 0) return { text: "flat", tone: "flat", spoken: "flat vs prior month" };
  const up = d > 0;
  const tone = up === higher(k) ? "good" : "bad";
  return {
    text: `${up ? "↑" : "↓"} ${shown}${unitText}`,
    tone,
    spoken: `${up ? "up" : "down"} ${shown}${unitText === "%" ? " percent" : unitText ? " points" : ""} vs prior month, ${tone === "good" ? "an improvement" : "a decline"}`,
  };
}

export const CHANGE_TONE: Record<Change["tone"], string> = { good: "text-ok", bad: "text-bad", flat: "text-ink-3" };

export type StatusCounts = { on: number; near: number; off: number; scored: number };

/** Scored = KPIs with a target and a value (Top-10 totals have no target; awaiting has no value). */
export function statusCounts(kpis: Scored[]): StatusCounts {
  const c = { on: 0, near: 0, off: 0, scored: 0 };
  for (const k of kpis) {
    const s = kpiStatus(k);
    if (s === "on" || s === "near" || s === "off") { c[s]++; c.scored++; }
  }
  return c;
}

/** "1 of 3 on track · 1 near" (near and off only when non-zero). */
export function countsLabel(c: StatusCounts, withOff = false): string {
  const parts = [`${c.on} of ${c.scored} on track`];
  if (c.near) parts.push(`${c.near} near`);
  if (withOff && c.off) parts.push(`${c.off} off`);
  return parts.join(" · ");
}
