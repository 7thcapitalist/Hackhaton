import type { MarketplaceMetricRow } from "@/app/_lib/types";
import { ChartFrame } from "./ChartFrame";

const num = "px-2.5 py-2 text-right tabular-nums whitespace-nowrap";
const dash = <span className="text-ink-4">—</span>;

/** CSAT, NPS and conversion per marketplace: the channels behind the averaged KPIs below. */
export function MarketplaceMetricsTable({ rows }: { rows: MarketplaceMetricRow[] }) {
  return (
    <ChartFrame title="By marketplace"
      subtitle="Each marketplace's own ratings for the month. The KPIs below average them; a dash means that marketplace does not report the metric.">
      <div className="-mx-2.5 overflow-x-auto">
        <table className="w-full min-w-[360px] border-collapse text-[13px] sm:text-[13.5px]" aria-label="Customer metrics by marketplace">
          <thead>
            <tr className="text-[12px] text-ink-3">
              <th scope="col" className="px-2.5 py-2 text-left font-normal">Marketplace</th>
              <th scope="col" className="px-2.5 py-2 text-right font-normal">Satisfaction (of 5)</th>
              <th scope="col" className="px-2.5 py-2 text-right font-normal">NPS</th>
              <th scope="col" className="px-2.5 py-2 text-right font-normal">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.channel} className="border-t border-line-2">
                <th scope="row" className="px-2.5 py-2 text-left font-medium text-ink">{r.label}</th>
                <td className={`${num} text-ink`}>{r.csat == null ? dash : r.csat.toFixed(2)}</td>
                <td className={`${num} text-ink`}>{r.nps == null ? dash : Math.round(r.nps)}</td>
                <td className={`${num} text-ink`}>{r.conversionRate == null ? dash : `${r.conversionRate.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
