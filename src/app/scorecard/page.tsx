import type { Metadata } from "next";
import { KpiCard } from "@/components/KpiCard";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PrintButton } from "@/components/PrintButton";
import { StatusLegend } from "@/components/StatusBadge";
import { PILLARS, getScorecard, getSourceSummary } from "../_lib/demo-data";
import { formatStampFull, trackStatus } from "../_lib/format";

export const metadata: Metadata = { title: "COO Scorecard – Mission Control" };

export default function ScorecardPage() {
  const { period, kpis, insights } = getScorecard();
  const anchors = kpis.filter(k => k.anchor2027);
  const src = getSourceSummary();
  const month = period.label.split(" ")[0];

  return (
    <div className="flex flex-col gap-5 px-4 pt-[26px] pb-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <p className="text-[12.5px] font-medium text-ink-3">Monthly · {kpis.length} KPIs across {PILLARS.length} pillars · data through {period.dataThrough}, Eastern Time</p>
          <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">COO Scorecard · {period.label}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <StatusLegend />
          <div data-print-hide>
            {/* The demo holds one closed month; real periods come from getScorecard(period). */}
            <PeriodStepper label={period.label} prevHref={null} nextHref={null} prevLabel="Previous month" nextLabel="Next month" />
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_320px]">
        {anchors.map(k => <KpiCard key={k.id} kpi={k} variant="anchor" />)}
        <aside className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface-2 px-5 py-[18px] md:col-span-3 xl:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13.5px] font-semibold">What&apos;s driving it</h2>
            <span className="rounded-[5px] border border-line bg-surface px-1.5 py-px font-mono text-[10.5px] font-medium text-ink-2">AI-written</span>
          </div>
          <ul className="flex list-disc flex-col gap-2 pl-4 text-[12.5px] leading-normal text-pretty text-ink-2">
            {insights.map(t => <li key={t}>{t}</li>)}
          </ul>
          <p className="mt-auto text-[11.5px] text-ink-3">Written from the numbers on this page · review before sharing</p>
        </aside>
      </div>

      <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 xl:grid-rows-[auto_repeat(3,auto)]">
        {PILLARS.map(p => {
          const ks = kpis.filter(k => k.pillar === p.id);
          const scored = ks.filter(k => k.value != null && k.target != null).length;
          const on = ks.filter(k => trackStatus(k) === "on").length;
          return (
            <section key={p.id} className="grid gap-y-2.5 xl:row-span-4 xl:grid-rows-subgrid" aria-label={p.name}>
              <header className="flex items-center justify-between gap-2 border-t-2 border-ink px-0.5 pt-1.5">
                <h2 className="text-xs font-semibold tracking-[0.04em] whitespace-nowrap uppercase">{p.name}</h2>
                {scored > 0 && <span className="text-[11.5px] whitespace-nowrap text-ink-3">{on}/{scored} on track</span>}
              </header>
              {ks.map(k => <KpiCard key={k.id} kpi={k} periodShort={period.short} />)}
            </section>
          );
        })}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-3 text-xs text-ink-3">
        <span>
          Sources: {src.arrived} of {src.total} received for {month}
          {src.missing.length > 0 && ` · ${src.missing.map(s => s.name).join(" and ")} files pending`} · Simulated values are demo estimates, not reported figures.
        </span>
        <span>Generated {formatStampFull(period.generatedAt)}</span>
      </footer>
    </div>
  );
}
