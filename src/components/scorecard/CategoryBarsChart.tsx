import type { CategoryBars } from "@/app/_lib/scorecard-charts";
import { formatDay, formatMoney } from "@/app/_lib/format";
import { niceScale } from "./chartScale";
import { ChartFrame, LegendItem } from "./ChartFrame";

const BAR = "var(--accent)";

/**
 * Sell-through and average selling price for the Top-10 revenue categories, as a table whose
 * cells carry bars: screen readers get a plain table, sighted readers see which categories pull
 * the two pillar KPIs below their targets.
 */
export function CategoryBarsChart({ data }: { data: CategoryBars }) {
  const { rows, sellThrough, asp } = data;
  const aspTop = niceScale(Math.max(asp.target ?? 0, ...rows.map(r => r.aspCents ?? 0), 1)).top;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;
  const fmtAsp = (v: number) => formatMoney(v);
  const below = (v: number | null, t: number | null) => v != null && t != null && v < t;
  const lowSt = rows.filter(r => below(r.sellThroughPct, sellThrough.target)).map(r => r.category);

  return (
    <ChartFrame
      title="Where sell-through and price come from"
      subtitle={<>
        Top 10 categories by revenue, biggest first.
        {data.inProgressThrough
          ? ` Month in progress (data through ${formatDay(data.inProgressThrough, { month: "short", day: "numeric" })}): sell-through counts items sold so far, so it reads low until the month ends.`
          : lowSt.length > 0 && sellThrough.target != null ? ` Below the ${fmtPct(sellThrough.target)} sell-through target: ${lowSt.join(", ")}.` : ""}
      </>}
      legend={<>
        <LegendItem kind="swatch" color={BAR}>Category value</LegendItem>
        <LegendItem kind="dash" color="var(--ink2)">Target (for all categories together)</LegendItem>
      </>}
    >
      <table className="w-full table-fixed border-collapse text-[12.5px]">
        <colgroup><col className="w-[92px] sm:w-[140px]" /><col /><col className="w-3 sm:w-8" /><col /></colgroup>
        <thead>
          <tr className="text-left align-bottom text-[12px] text-ink-3">
            <th scope="col" className="pb-1.5 font-normal">Category</th>
            <th scope="col" className="pb-1.5 font-normal">
              <span className="block font-medium text-ink-2">Sell-through</span>
              <span className="block">{sellThrough.overall != null ? `all ${fmtPct(sellThrough.overall)}` : ""}{sellThrough.target != null && <> · <span className="whitespace-nowrap">target ≥ {sellThrough.target}%</span></>}</span>
            </th>
            <td aria-hidden />
            <th scope="col" className="pb-1.5 font-normal">
              <span className="block font-medium text-ink-2">Avg selling price</span>
              <span className="block">{asp.overall != null ? `all ${fmtAsp(asp.overall)}` : ""}{asp.target != null && <> · <span className="whitespace-nowrap">target ≥ {fmtAsp(asp.target).replace(/\.00$/, "")}</span></>}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.category} className="border-t border-line-2">
              <th scope="row" className="truncate py-1 pr-2 text-left font-normal text-ink-2" title={r.category}>{r.category}</th>
              <td className="py-1"><BarCell value={r.sellThroughPct} max={100} target={sellThrough.target} text={r.sellThroughPct == null ? "—" : fmtPct(r.sellThroughPct)} /></td>
              <td aria-hidden />
              <td className="py-1"><BarCell value={r.aspCents} max={aspTop} target={asp.target} text={r.aspCents == null ? "—" : fmtAsp(r.aspCents)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartFrame>
  );
}

/** One bar with its value at the tip and the target as a dashed rule that lines up across rows. */
function BarCell({ value, max, target, text }: { value: number | null; max: number; target: number | null; text: string }) {
  const w = value == null ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="relative mr-12 h-5 sm:mr-14">
      {value != null && <div className="absolute top-1/2 left-0 h-2.5 -translate-y-1/2 rounded-r-[4px]" style={{ width: `${w}%`, background: BAR }} />}
      <span className="absolute top-1/2 z-10 ml-1 -translate-y-1/2 rounded-sm bg-surface/85 px-0.5 text-[12px] font-medium whitespace-nowrap text-ink tabular-nums" style={{ left: `${w}%` }}>{text}</span>
      {target != null && <span aria-hidden className="absolute -top-1 -bottom-1 border-l-[1.5px] border-dashed border-ink-2" style={{ left: `${Math.min(100, (target / max) * 100)}%` }} />}
    </div>
  );
}
