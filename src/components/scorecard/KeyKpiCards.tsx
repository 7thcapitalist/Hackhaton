import type { Kpi } from "@/app/_lib/types";
import { formatKpiShort } from "@/app/_lib/format";
import { CHANGE_TONE, STATUS_META, formatTarget, formatValue, kpiChange, kpiStatus, type Status } from "@/app/scorecard/kpiFormat";
import { EstMarker } from "./EstMarker";
import { InfoTip } from "./InfoTip";

const KEY_KPIS_HINT = "The three KPIs Goodwill's 2027 plan is built around (slide 36).";
const BAR: Partial<Record<Status, string>> = { on: "var(--ok)", near: "var(--warn-icon)", off: "var(--bad)" };
const TARGET_AT = 1 / 1.25; // the target tick sits at 80% of the bar, leaving room to show a beat

/** The key KPIs as three columns of one strip: value, status, progress to target, and the change vs last month. */
export function KeyKpiCards({ kpis, prevMonth }: { kpis: Kpi[]; prevMonth: string }) {
  return (
    <section aria-labelledby="key-kpis-title" className="flex flex-col gap-2.5 break-inside-avoid">
      <h2 id="key-kpis-title" className="flex items-center gap-1.5 text-[14px] font-semibold">
        Key KPIs<InfoTip text={KEY_KPIS_HINT} label="Key KPIs" />
      </h2>
      <div className="grid grid-cols-1 divide-y divide-line rounded-lg border border-line bg-surface md:grid-cols-3 md:divide-x md:divide-y-0">
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
    <article className="flex min-w-0 flex-col gap-3 px-5 py-4">
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-[13px] leading-snug text-ink-2">{k.label}</h3>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap ${meta.fg}`}><span aria-hidden>{meta.icon}</span>{meta.label}</span>
      </header>
      <p className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
        {v ? <>
          <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-ink">{v.value}</span>
          {v.suffix && <span className="text-[13px] text-ink-3">{v.suffix}</span>}
          {k.status === "simulated" && <EstMarker />}
        </> : <span className="text-[15px] text-ink-3">Awaiting data</span>}
      </p>
      {progress != null && (
        <div className="relative h-1 bg-line-2" role="img"
          aria-label={`${Math.round(progress * 100)}% of the way to the target`}>
          <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(progress * TARGET_AT, 1) * 100}%`, background: BAR[status] ?? "var(--ink4)" }} />
          <span aria-hidden className="absolute -top-1 -bottom-1 w-px bg-ink-2" style={{ left: `${TARGET_AT * 100}%` }} />
        </div>
      )}
      <footer className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12.5px]">
        <span className="whitespace-nowrap text-ink-2 tabular-nums">Target {formatTarget(k)}</span>
        {change ? (
          <span className={`font-medium whitespace-nowrap tabular-nums ${CHANGE_TONE[change.tone]}`} aria-label={`${change.spoken}; ${prevMonth} was ${formatKpiShort(k.unit, k.previous)}`}>
            {change.text} <span className="font-normal text-ink-3">vs {prevMonth} ({formatKpiShort(k.unit, k.previous)})</span>
          </span>
        ) : <span className="text-ink-3">No {prevMonth} value</span>}
      </footer>
    </article>
  );
}
