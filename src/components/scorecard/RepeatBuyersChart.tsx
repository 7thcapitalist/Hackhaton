import type { RepeatBuyers } from "@/app/_lib/scorecard-charts";
import { niceScale } from "./chartScale";
import { ChartFrame, LegendItem } from "./ChartFrame";

const NOW = "var(--accent)", LY = "var(--ink4)";
const PLOT_H = 132;

/** Repeat buyer rate per month next to the same month last year, with the target as a rule. */
export function RepeatBuyersChart({ data }: { data: RepeatBuyers }) {
  const { months, target } = data;
  const values = months.flatMap(m => [m.thisYear, m.lastYear]).filter((v): v is number => v != null);
  const { step, top } = niceScale(Math.max(target ?? 0, ...values) * 1.08);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const y = (v: number) => (v / top) * 100;
  const fmt = (v: number) => `${v.toFixed(1)}%`;
  const thisYear = months[0]?.period.slice(0, 4), lastYear = months[0]?.lastYearPeriod.slice(0, 4);
  const sel = months.find(m => m.selected);
  const summary = sel?.thisYear != null
    ? `${sel.month}: ${fmt(sel.thisYear)}${sel.lastYear != null ? ` vs ${fmt(sel.lastYear)} in ${sel.month} ${sel.lastYearPeriod.slice(0, 4)}` : ""}${target != null ? `, target ${fmt(target)}` : ""}.`
    : sel?.inProgress ? `${sel.month} is still in progress: the rate counts buyers with 2+ orders in the month, so it is shown once the month ends.` : "";

  return (
    <ChartFrame
      title="Repeat buyer rate, this year vs last"
      subtitle={<>Share of the month&apos;s buyers who ordered 2+ times that month. {summary}</>}
      legend={<>
        <LegendItem kind="swatch" color={NOW}>{thisYear}</LegendItem>
        <LegendItem kind="swatch" color={LY}>{lastYear}</LegendItem>
        {target != null && <LegendItem kind="dash" color="var(--ink2)">Target {fmt(target)}</LegendItem>}
      </>}
      className="max-w-[560px]"
    >
      <div className="flex gap-2" role="img" aria-label={`Repeat buyer rate by month. ${months.map(m => `${m.month}: ${m.thisYear != null ? fmt(m.thisYear) : m.inProgress ? "in progress" : "no data"} this year, ${m.lastYear != null ? fmt(m.lastYear) : "no data"} last year`).join("; ")}.${target != null ? ` Target ${fmt(target)}.` : ""}`}>
        <div aria-hidden className="relative w-8 shrink-0 text-right text-[11px] text-ink-3" style={{ height: PLOT_H }}>
          {ticks.map(t => <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${y(t)}%` }}>{t}%</span>)}
        </div>
        <div aria-hidden className="flex min-w-0 flex-1 flex-col">
          <div className="relative border-b border-line" style={{ height: PLOT_H }}>
            {ticks.slice(1).map(t => <span key={t} className="absolute inset-x-0 border-t border-line-2" style={{ bottom: `${y(t)}%` }} />)}
            <div className="absolute inset-0 flex">
              {months.map(m => (
                <div key={m.period} className="flex flex-1 items-end justify-center gap-0.5">
                  <Bar value={m.lastYear} color={LY} fmt={fmt} y={y} />
                  <Bar value={m.thisYear} color={NOW} fmt={fmt} y={y} />
                </div>
              ))}
            </div>
            {target != null && (
              <span className="absolute inset-x-0 border-t-[1.5px] border-dashed border-ink-2" style={{ bottom: `${y(target)}%` }} />
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

function Bar({ value, color, fmt, y }: { value: number | null; color: string; fmt: (v: number) => string; y: (v: number) => number }) {
  return (
    <div className="relative flex h-full w-8 flex-col justify-end">
      {value != null && (
        <>
          <span className="absolute left-1/2 z-10 mb-0.5 -translate-x-1/2 rounded-sm bg-surface/85 px-px text-[11px] font-medium whitespace-nowrap text-ink tabular-nums" style={{ bottom: `${y(value)}%` }}>{fmt(value)}</span>
          <div className="w-full rounded-t-[4px]" style={{ height: `${y(value)}%`, background: color }} />
        </>
      )}
    </div>
  );
}
