import type { MonthlyKpiBars } from "@/app/_lib/scorecard-charts";
import { formatKpiShort } from "@/app/_lib/format";
import { niceScale } from "./chartScale";
import { ChartFrame, LegendItem } from "./ChartFrame";

const BAR = "var(--accent)", PAST = "var(--accent-line)";
const PLOT_H = 132;

type Props = { data: MonthlyKpiBars; title: string; subtitle: string };

/** One KPI per month as bars, with its target as a dashed rule. Months without data have no bar, never a zero bar. */
export function MonthlyKpiBarsChart({ data, title, subtitle }: Props) {
  const { kpi, months } = data;
  const fmt = (v: number) => formatKpiShort(kpi.unit, v);
  const values = months.map(m => m.value).filter((v): v is number => v != null);
  const { step, top } = niceScale(Math.max(kpi.target ?? 0, ...values) * 1.08);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const y = (v: number) => (v / top) * 100;
  const short = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : String(Math.round(v));
  const cmp = kpi.higherIsBetter ? "≥" : "≤";
  const sel = months.find(m => m.selected);
  const summary = sel?.value != null
    ? `${sel.month}: ${fmt(sel.value)}${kpi.target != null ? ` vs target ${cmp} ${fmt(kpi.target)}` : ""}${sel.inProgress ? " (month in progress)" : ""}.`
    : "";

  return (
    <ChartFrame
      title={title}
      subtitle={<>{subtitle} {summary}</>}
      legend={<>
        <LegendItem kind="swatch" color={BAR}>{kpi.label}</LegendItem>
        {kpi.target != null && <LegendItem kind="dash" color="var(--ink2)">Target {cmp} {fmt(kpi.target)}</LegendItem>}
      </>}
      className="max-w-[560px]"
    >
      <div className="flex gap-2" role="img" aria-label={`${kpi.label} by month. ${months.map(m => `${m.month}: ${m.value != null ? fmt(m.value) : "no data"}${m.inProgress ? " (in progress)" : ""}`).join("; ")}.${kpi.target != null ? ` Target ${cmp} ${fmt(kpi.target)}.` : ""}`}>
        <div aria-hidden className="relative w-8 shrink-0 text-right text-[11px] text-ink-3" style={{ height: PLOT_H }}>
          {ticks.map(t => <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${y(t)}%` }}>{short(t)}</span>)}
        </div>
        <div aria-hidden className="flex min-w-0 flex-1 flex-col">
          <div className="relative border-b border-line" style={{ height: PLOT_H }}>
            {ticks.slice(1).map(t => <span key={t} className="absolute inset-x-0 border-t border-line-2" style={{ bottom: `${y(t)}%` }} />)}
            <div className="absolute inset-0 flex">
              {months.map(m => (
                <div key={m.period} className="flex flex-1 items-end justify-center">
                  <div className="relative flex h-full w-7 flex-col justify-end sm:w-9">
                    {m.value != null && (
                      <>
                        <span className="absolute left-1/2 z-10 mb-0.5 -translate-x-1/2 rounded-sm bg-surface/85 px-px text-[11px] font-medium whitespace-nowrap text-ink tabular-nums" style={{ bottom: `${y(m.value)}%` }}>{short(m.value)}</span>
                        <div className="w-full rounded-t-[4px]" style={{ height: `${y(m.value)}%`, background: m.selected ? BAR : PAST }} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {kpi.target != null && (
              <span className="absolute inset-x-0 border-t-[1.5px] border-dashed border-ink-2" style={{ bottom: `${y(kpi.target)}%` }} />
            )}
          </div>
          <div className="flex pt-1.5 text-[12px]">
            {months.map(m => (
              <div key={m.period} className="flex flex-1 flex-col items-center leading-tight">
                <span className={m.selected ? "border-b-2 border-accent font-semibold text-ink" : "text-ink-2"}>{m.month}</span>
                {m.inProgress && <span className="text-[11px] text-ink-3">in progress</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ChartFrame>
  );
}
