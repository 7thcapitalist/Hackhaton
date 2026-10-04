import type { Kpi } from "@/app/_lib/types";
import { formatKpiShort } from "@/app/_lib/format";
import { CHANGE_TONE, STATUS_META, formatTarget, formatValue, kpiChange, kpiStatus, type Status } from "@/app/scorecard/kpiFormat";
import { EstMarker } from "./EstMarker";
import { InfoTip } from "./InfoTip";

const KEY_KPIS_HINT = "The month's headline numbers: revenue, orders and net margin.";
const BAR: Partial<Record<Status, string>> = { on: "var(--ok)", near: "var(--warn-icon)", off: "var(--bad)" };
const TARGET_AT = 1 / 1.25; // the target tick sits at 80% of the bar, leaving room to show a beat

/** The key KPIs as three cards: value, status, progress to target, and the change vs last month. */
export function KeyKpiCards({ kpis, prevMonth }: { kpis: Kpi[]; prevMonth: string }) {
  return (
    <section aria-labelledby="key-kpis-title" className="flex flex-col gap-2.5 break-inside-avoid">
      <h2 id="key-kpis-title" className="flex items-center gap-1.5 text-[15px] font-semibold">
        Key KPIs<InfoTip text={KEY_KPIS_HINT} label="Key KPIs" />
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {kpis.map(k => <KeyKpiCard key={k.id} kpi={k} prevMonth={prevMonth} />)}
      </div>
    </section>
  );
}

function KeyKpiCard({ kpi: k, prevMonth }: { kpi: Kpi; prevMonth: string }) {
  const status = kpiStatus(k), meta = STATUS_META[status];
  const v = formatValue(k), change = kpiChange(k);
  const progress = k.value != null && k.target ? (k.higherIsBetter === false ? k.target / k.value : k.value / k.target) : null;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line border-t-[3px] border-t-brand bg-surface px-5 py-4.5 shadow-xs">
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-[13.5px] leading-snug font-medium text-ink-2">{k.label}</h3>
        {status !== "none" && <span className={`inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold whitespace-nowrap ${meta.fg}`}><span aria-hidden>{meta.icon}</span>{meta.label}</span>}
      </header>
      <p className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
        {v ? <>
          <span className="font-display text-[44px] leading-none font-semibold text-ink">{v.value}</span>
          {v.suffix && <span className="text-[13px] text-ink-3">{v.suffix}</span>}
          {k.status === "simulated" && <EstMarker />}
        </> : <span className="text-[15px] text-ink-3">Awaiting data</span>}
      </p>
      {progress != null && (
        <div className="relative h-1.5 rounded-full bg-surface-2" role="img"
          aria-label={`${Math.round(progress * 100)}% of the way to the target`}>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(progress * TARGET_AT, 1) * 100}%`, background: BAR[status] ?? "var(--ink4)" }} />
          <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink-2" style={{ left: `${TARGET_AT * 100}%` }} />
        </div>
      )}
      {/* mt-auto keeps the footers level when one card has no target bar. */}
      <footer className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12.5px]">
        <span className="whitespace-nowrap text-ink-2 tabular-nums">{k.target != null ? `Target ${formatTarget(k)}` : "No target set"}</span>
        {change ? (
          <span className={`font-medium whitespace-nowrap tabular-nums ${CHANGE_TONE[change.tone]}`} aria-label={`${change.spoken}; ${prevMonth} was ${formatKpiShort(k.unit, k.previous)}`}>
            {change.text} <span className="font-normal text-ink-3">vs {prevMonth} ({formatKpiShort(k.unit, k.previous)})</span>
          </span>
        ) : <span className="text-ink-3">No {prevMonth} value</span>}
      </footer>
    </article>
  );
}
