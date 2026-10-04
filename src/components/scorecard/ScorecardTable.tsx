import type { ReactNode } from "react";
import type { Kpi, Pillar } from "@/app/_lib/types";
import { formatKpiShort } from "@/app/_lib/format";
import { CHANGE_TONE, PILLARS, STATUS_META, countsLabel, formatTarget, formatValue, kpiChange, kpiStatus, statusCounts, type StatusCounts } from "@/app/scorecard/kpiFormat";
import { Tooltip } from "../Tooltip";
import { CollapsibleCard } from "./CollapsibleCard";
import { EstMarker } from "./EstMarker";
import { InfoTip } from "./InfoTip";

type ScorecardTableProps = {
  kpis: Kpi[];
  prevMonth: string; // "Aug"
  /** Optional charts shown above a pillar's KPI rows when its section is open. */
  charts?: Partial<Record<Pillar, ReactNode>>;
  /** Prefix for the cards' ids, so two tables can share a page (default "pillar"). */
  idPrefix?: string;
};

export const KEY_KPI_HINT = "One of the three KPIs Goodwill's 2027 plan is built around.";
export const TEAM_LEVEL_NOTE = "Team-level, for capacity planning.";
const CATEGORY_KPIS = new Set([
  "top10_categories_revenue", "top10_categories_margin",
  "sales_by_category", "margin_by_category", "units_by_category", "sell_through_by_category", "asp_by_category",
]);

// Desktop: one table per pillar with the same fixed column widths, so columns line up across cards.
// Phones: each KPI is a two-line grid (status · name · value · target, then the change).
const row = "border-t border-line-2 max-sm:grid max-sm:grid-cols-[18px_minmax(0,1fr)_auto_auto] max-sm:items-baseline max-sm:gap-x-2.5 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3";
const cell = "px-3 py-3 align-middle max-sm:p-0";
const num = "text-right tabular-nums whitespace-nowrap";
const head = "px-3 pt-2.5 pb-1.5 font-normal";

/** KPIs (the COO 15, or the extended set) as one collapsible card per pillar. */
export function ScorecardTable({ kpis, prevMonth, charts, idPrefix = "pillar" }: ScorecardTableProps) {
  return (
    <div className="flex flex-col gap-3">
      {PILLARS.map(p => {
        const ks = kpis.filter(k => k.pillar === p.id);
        if (ks.length === 0) return null;
        const c = statusCounts(ks);
        return (
          <CollapsibleCard key={p.id} id={`${idPrefix}-${p.id}`} title={p.name}
            meta={c.scored > 0 ? <><StatusBar counts={c} /><span>{countsLabel(c, true)}</span></> : <span>No targets</span>}>
            {charts?.[p.id] && <div className="flex flex-col gap-7 border-b border-line-2 px-4 pt-4 pb-5 sm:px-5">{charts[p.id]}</div>}
            <table className="w-full table-fixed border-collapse text-[13.5px] max-sm:block" aria-label={`${p.name} KPIs`}>
              <colgroup>
                <col className="w-[132px]" /><col /><col className="w-[220px]" /><col className="w-[130px]" /><col className="w-[116px]" />
              </colgroup>
              <thead className="max-sm:hidden">
                <tr className="text-left text-[12px] text-ink-3">
                  <th scope="col" className={`${head} sm:pl-5`}>Status</th>
                  <th scope="col" className={head}>KPI</th>
                  <th scope="col" className={`${head} text-right`}>Value</th>
                  <th scope="col" className={`${head} text-right`}>Target</th>
                  <th scope="col" className={`${head} text-right sm:pr-5`}>vs {prevMonth}</th>
                </tr>
              </thead>
              <tbody className="max-sm:block">
                {ks.map(k => <KpiRow key={k.id} kpi={k} prevMonth={prevMonth} />)}
              </tbody>
            </table>
          </CollapsibleCard>
        );
      })}
    </div>
  );
}

/** On / near / off as one small segmented bar; the text label next to it carries the numbers. */
function StatusBar({ counts: c }: { counts: StatusCounts }) {
  const seg = (n: number, color: string) => n > 0 && <span className="h-full" style={{ width: `${(n / c.scored) * 100}%`, background: color }} />;
  return (
    <span aria-hidden className="flex h-1.5 w-20 gap-px overflow-hidden rounded-full bg-surface-2 max-sm:hidden">
      {seg(c.on, "var(--ok)")}{seg(c.near, "var(--warn-icon)")}{seg(c.off, "var(--bad)")}
    </span>
  );
}

function KpiRow({ kpi: k, prevMonth }: { kpi: Kpi; prevMonth: string }) {
  const status = kpiStatus(k);
  const meta = STATUS_META[status];
  const v = formatValue(k);
  const change = kpiChange(k);
  const estimated = k.status === "simulated";
  const note = [k.note, k.teamLevel ? TEAM_LEVEL_NOTE : null].filter(Boolean).join(" ");
  return (
    <tr className={row}>
      <td className={`${cell} sm:pl-5 max-sm:row-start-1`}>
        <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold whitespace-nowrap ${meta.fg}`}>
          <span aria-hidden className="w-3 text-center">{meta.icon}</span>
          <span className={`max-sm:sr-only ${status === "none" || status === "awaiting" ? "font-normal" : ""}`}>{meta.label}</span>
        </span>
      </td>
      <th scope="row" className={`${cell} text-left font-normal max-sm:row-start-1`}>
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {CATEGORY_KPIS.has(k.id)
            ? <a href="#categories" className="font-medium text-ink underline decoration-ink-4 decoration-dotted underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-accent">{k.label}</a>
            : <span className="font-medium text-ink">{k.label}</span>}
          {k.anchor2027 && <span className="rounded-[4px] bg-accent-soft px-1.5 text-[11px] leading-[17px] font-semibold whitespace-nowrap text-accent" title={KEY_KPI_HINT}>Key KPI</span>}
          {note && <InfoTip text={note} label={k.label} />}
        </span>
      </th>
      <td className={`${cell} ${num} max-sm:row-start-1`}>
        {v ? (
          <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
            <span className="font-semibold text-ink">{v.value}</span>
            {v.suffix && <span className="text-[12px] text-ink-3">{v.suffix}</span>}
            {k.valueNote && <span className="text-[12px] text-ink-3">· {k.valueNote}</span>}
            {estimated && <EstMarker />}
          </span>
        ) : <span className="text-ink-3">Awaiting data</span>}
      </td>
      <td className={`${cell} ${num} text-ink-2 max-sm:row-start-1 max-sm:text-[12.5px]`}>{formatTarget(k)}</td>
      <td className={`${cell} ${num} sm:pr-5 max-sm:col-start-2 max-sm:row-start-2 max-sm:text-left max-sm:text-[12.5px]`}>
        {change ? (
          <Tooltip text={`${prevMonth}: ${formatKpiShort(k.unit, k.previous)}`} align="end">
            <span tabIndex={0} className={`rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-accent ${CHANGE_TONE[change.tone]}`}
              aria-label={`${change.spoken}; ${prevMonth} was ${formatKpiShort(k.unit, k.previous)}`}>{change.text}</span>
          </Tooltip>
        ) : <span className="text-ink-4" aria-label={k.previous == null ? `No ${prevMonth} value` : undefined}>—</span>}
      </td>
    </tr>
  );
}
