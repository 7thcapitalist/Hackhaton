// Pure helpers for the Daily Pulse: the same-weekday baseline, when a change counts as
// unusual, and the one-to-two sentence summary of the day. No I/O, safe on server and client.
import { formatMoneyWhole } from "../_lib/format";

/** How many standard deviations from the same-weekday mean count as unusual. Tune here. */
export const SIGNIFICANCE_SD = 1;

/** One metric over the earlier same weekdays (newest first). */
export type BaselineStats = { mean: number; sd: number | null; n: number };

export type PulseMetric = "revenue" | "customers" | "orders";

export type PulseBaseline = {
  weekday: string;   // "Friday"
  dates: string[];   // the same weekdays used, newest first (at most `wanted`)
  wanted: number;    // 4
  stats: Record<PulseMetric, BaselineStats>;
};

/** Mean and sample standard deviation (null below two values: one point has no spread). */
export function statsOf(values: number[]): BaselineStats {
  const n = values.length;
  const mean = n ? values.reduce((a, v) => a + v, 0) / n : 0;
  const sd = n >= 2 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null;
  return { mean, sd, n };
}

export type Significance = {
  pct: number | null;                    // change vs the baseline mean, in %
  level: "up" | "down" | "neutral";      // up/down only when beyond SIGNIFICANCE_SD
  note: string;                          // "Unusually low for a Friday"
};

export function significance(value: number, stats: BaselineStats | undefined, weekday: string, threshold = SIGNIFICANCE_SD): Significance {
  if (!stats || stats.n === 0) return { pct: null, level: "neutral", note: `No earlier ${weekday}s to compare` };
  const pct = stats.mean ? ((value - stats.mean) / stats.mean) * 100 : null;
  if (stats.sd == null) return { pct, level: "neutral", note: `Only 1 earlier ${weekday}, too few to judge` };
  const diff = value - stats.mean;
  if (Math.abs(diff) <= threshold * stats.sd) return { pct, level: "neutral", note: `Within the usual range for a ${weekday}` };
  return diff > 0
    ? { pct, level: "up", note: `Unusually high for a ${weekday}` }
    : { pct, level: "down", note: `Unusually low for a ${weekday}` };
}

/** "vs last 4 Fridays", or fewer when the data starts later. */
export function baselineLabel(b: PulseBaseline): string {
  const n = b.dates.length;
  const label = n === 1 ? `vs last ${b.weekday}` : `vs last ${n} ${b.weekday}s`;
  return n < b.wanted ? `${label} (only ${n} in the data)` : label;
}

export const weekdayOf = (isoDate: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));

export type SummaryInput = {
  date: string;      // YYYY-MM-DD business date
  partial: boolean;  // files arrived before the day ended
  rows: { label: string; status: "ok" | "missing"; revenueCents: number | null }[];
  totals: { revenueCents: number; customers: number; orders: number };
  baseline: PulseBaseline | null;
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * "Friday closed at $4,684, 3% below a typical Friday. ShopGoodwill carried 60% of revenue;
 * orders were unusually light." Deterministic: only metrics beyond SIGNIFICANCE_SD are called unusual.
 */
export function buildPulseSummary({ date, partial, rows, totals, baseline }: SummaryInput): string {
  const weekday = weekdayOf(date);
  const ok = rows.filter(r => r.status === "ok");
  const missing = rows.filter(r => r.status === "missing").map(r => r.label);
  if (ok.length === 0) return `No marketplace has reported for ${weekday} yet.`;

  const revenue = formatMoneyWhole(totals.revenueCents);
  let first: string;
  if (partial) {
    first = `${weekday} so far: ${revenue} from files that arrived before the day ended, so it is not compared yet.`;
  } else if (!baseline || baseline.dates.length === 0) {
    first = `${weekday} closed at ${revenue}; there are no earlier ${weekday}s to compare with.`;
  } else {
    const s = significance(totals.revenueCents, baseline.stats.revenue, weekday);
    const r = s.pct == null ? null : Math.round(s.pct);
    const vs = r == null || r === 0 ? `in line with a typical ${weekday}` : `${Math.abs(r)}% ${r > 0 ? "above" : "below"} a typical ${weekday}`;
    first = s.level === "neutral"
      ? `${weekday} closed at ${revenue}, ${vs}.`
      : `${weekday} closed at ${revenue}, unusually ${s.level === "up" ? "high" : "low"} at ${vs}.`;
  }

  const clauses: string[] = [];
  const top = [...ok].sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0))[0];
  if (totals.revenueCents > 0 && (top.revenueCents ?? 0) > 0) {
    const share = Math.round(((top.revenueCents ?? 0) / totals.revenueCents) * 100);
    clauses.push(`${top.label} carried ${share}% of revenue${missing.length ? ` (${list(missing)} ${missing.length > 1 ? "have" : "has"} not reported yet)` : ""}`);
  } else if (missing.length) {
    clauses.push(`${list(missing)} ${missing.length > 1 ? "have" : "has"} not reported yet`);
  }
  if (!partial && baseline) {
    const unusual: string[] = [];
    const orders = significance(totals.orders, baseline.stats.orders, weekday);
    const customers = significance(totals.customers, baseline.stats.customers, weekday);
    if (orders.level !== "neutral") unusual.push(`orders were unusually ${orders.level === "up" ? "heavy" : "light"}`);
    if (customers.level !== "neutral") unusual.push(`unique customers were unusually ${customers.level === "up" ? "many" : "few"}`);
    if (unusual.length) clauses.push(list(unusual));
  }
  if (clauses.length === 0) return first;
  const second = clauses.join("; ");
  return `${first} ${second[0].toUpperCase()}${second.slice(1)}.`;
}
