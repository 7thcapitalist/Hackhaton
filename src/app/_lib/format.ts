import type { Kpi, KpiUnit } from "./types";

export const TZ = "America/Indiana/Indianapolis";

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** $11.1k for hero numbers; under $1k shows whole dollars. */
export function formatMoneyCompact(cents: number): string {
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${Math.round(d).toLocaleString("en-US")}`;
}

export const formatInt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Business dates are plain YYYY-MM-DD already in Eastern Time, so format them as UTC to avoid a day shift. */
export function formatDay(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

export const formatDayLong = (isoDate: string) => formatDay(isoDate, { weekday: "long", month: "short", day: "numeric", year: "numeric" });

/** Timestamps (ISO with time) in Eastern Time. */
export function formatStamp(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: TZ }).format(new Date(iso));
}

/** "Sat, Oct 3, 2026 · 6:12 AM ET" */
export function formatStampFull(iso: string) {
  const day = formatStamp(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `${day} · ${formatStamp(iso, { hour: "numeric", minute: "2-digit" })} ET`;
}

export function formatClock(minute: number) {
  const h = Math.floor(minute / 60), mm = String(minute % 60).padStart(2, "0");
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

export function shiftDay(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}

export function formatKpiValue(unit: KpiUnit, v: number): { value: string; suffix: string } {
  switch (unit) {
    case "percent": return { value: `${v.toFixed(1)}%`, suffix: "" };
    case "cents": return { value: v >= 100_000 ? formatMoneyCompact(v) : formatMoney(v), suffix: "" };
    case "cents_per_hour": return { value: formatMoney(v), suffix: "/ labor hr" };
    case "days": return { value: v.toFixed(1), suffix: "days" };
    case "ratio": return { value: formatInt(v), suffix: "per person" };
    case "count": return { value: formatInt(v), suffix: "" };
  }
}

export function formatKpiShort(unit: KpiUnit, v: number | null): string {
  if (v == null) return "—";
  const f = formatKpiValue(unit, v);
  return unit === "days" ? `${f.value} days` : unit === "cents_per_hour" ? `${f.value}/hr` : f.value;
}

/** Percent KPIs change in points; everything else in %. */
export function formatChange(kpi: Pick<Kpi, "unit" | "value" | "previous">): string | null {
  const { unit, value, previous } = kpi;
  if (value == null || previous == null) return null;
  const d = value - previous;
  const arrow = d >= 0 ? "↑" : "↓";
  if (unit === "percent") return `${arrow} ${Math.abs(d).toFixed(1)} pts`;
  if (previous === 0) return null;
  return `${arrow} ${Math.abs((d / previous) * 100).toFixed(1)}%`;
}

export type Track = "on" | "near" | "off" | "none" | "awaiting";
export function trackStatus(kpi: Pick<Kpi, "value" | "target" | "lowerIsBetter">, nearBand = 0.05): Track {
  if (kpi.value == null) return "awaiting";
  if (kpi.target == null) return "none";
  const r = kpi.lowerIsBetter ? kpi.target / kpi.value : kpi.value / kpi.target;
  return r >= 1 ? "on" : r >= 1 - nearBand ? "near" : "off";
}

export const TRACK: Record<Track, { label: string; short: string; fg: string; bg: string }> = {
  on: { label: "✓ On track", short: "on track", fg: "text-ok", bg: "bg-ok-soft" },
  near: { label: "◐ Near target", short: "near", fg: "text-warn", bg: "bg-warn-soft" },
  off: { label: "↓ Off track", short: "off track", fg: "text-bad", bg: "bg-bad-soft" },
  none: { label: "No target", short: "no target", fg: "text-ink-3", bg: "bg-muted-soft" },
  awaiting: { label: "—", short: "awaiting", fg: "text-ink-3", bg: "bg-muted-soft" },
};

export function pctChange(curr: number, prev: number | null): number | null {
  return prev ? ((curr - prev) / prev) * 100 : null;
}
