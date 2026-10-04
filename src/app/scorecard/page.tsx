import type { Metadata } from "next";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PrintButton } from "@/components/PrintButton";
import { AskDataButton } from "@/components/scorecard/AskDataButton";
import { CategoriesTable } from "@/components/scorecard/CategoriesTable";
import { ToggleAllSections } from "@/components/scorecard/CollapsibleCard";
import { KeyKpiCards } from "@/components/scorecard/KeyKpiCards";
import { ScorecardTable } from "@/components/scorecard/ScorecardTable";
import { getDataRange, getScorecardScreen, getSourcesScreen, periodLabel, periodShort, resolvePeriod, summarizeSources } from "../_lib/data";
import { formatDay, formatStampFull } from "../_lib/format";
import { periodBounds, previousPeriod } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Monthly report – Mission Control" };

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const period = resolvePeriod(range, (await searchParams).period);
  const [{ kpis, categories, totalRevenueCents }, sourcesData] = await Promise.all([getScorecardScreen(period), getSourcesScreen(range, period)]);
  const anchors = kpis.filter(k => k.anchor2027);
  const src = summarizeSources(sourcesData.sources);
  const i = range.periods.indexOf(period);
  const through = [periodBounds(period).end, range.latestDate].sort()[0];
  const label = periodLabel(period);
  const month = label.split(" ")[0];
  const prevMonth = periodShort(previousPeriod(period));
  const issues = sourcesData.openIssues;

  return (
    <div className="flex flex-col gap-6 px-4 pt-[26px] pb-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">Monthly report</h1>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col items-start gap-1">
            <div data-print-hide>
              <PeriodStepper label={label}
                prevHref={i > 0 ? `/scorecard?period=${range.periods[i - 1]}` : null}
                nextHref={i < range.periods.length - 1 ? `/scorecard?period=${range.periods[i + 1]}` : null}
                prevLabel="Previous month" nextLabel="Next month" />
            </div>
            <span className="hidden text-[15px] font-semibold print:block">{label}</span>
            <span className="pl-1 text-[11.5px] text-ink-3">data through {formatDay(through, { month: "short", day: "numeric" })}, ET</span>
          </div>
          <AskDataButton />
          <PrintButton />
        </div>
      </header>

      <KeyKpiCards kpis={anchors} prevMonth={prevMonth} />

      <section aria-labelledby="pillars-title" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="pillars-title" className="text-[15px] font-semibold">All KPIs by pillar</h2>
          <ToggleAllSections />
        </div>
        <ScorecardTable kpis={kpis} prevMonth={prevMonth} />
      </section>

      <CategoriesTable rows={categories} totalRevenueCents={totalRevenueCents} monthLabel={month} />

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-3 text-xs text-ink-3">
        <span>
          Sources: {src.arrived} of {src.total} received for {month}
          {src.missing.length > 0 && ` · ${src.missing.map(s => s.name).join(", ")} pending`}
          {issues > 0 && ` · ${issues} open issue${issues === 1 ? "" : "s"}`}
        </span>
        <span>Data as of {formatStampFull(range.lastImportAt)}</span>
      </footer>
    </div>
  );
}
