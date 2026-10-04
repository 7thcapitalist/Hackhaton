import type { Metadata } from "next";
import { CheckIcon, DashedRingIcon, WarnIcon } from "@/components/icons";
import { PeriodStepper } from "@/components/PeriodStepper";
import { SourceStrip } from "@/components/SourceStrip";
import { SourcesBoard } from "./SourcesBoard";
import { getDataRange, getSourcesScreen, periodLabel, resolvePeriod, summarizeSources } from "../_lib/data";

export const metadata: Metadata = { title: "Data Sources – Mission Control" };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const period = resolvePeriod(range, (await searchParams).period);
  const data = await getSourcesScreen(range, period);
  const src = summarizeSources(data.sources);
  const label = periodLabel(period);
  const month = label.split(" ")[0];
  const i = range.periods.indexOf(period);

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-10 sm:px-8 sm:pt-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] leading-tight sm:text-[24px]">Data Sources</h1>
          <p className="text-[13px] text-ink-3">{src.total} sources, nightly and month-end files</p>
        </div>
        <PeriodStepper label={label}
          prevHref={i > 0 ? `/sources?period=${range.periods[i - 1]}` : null}
          nextHref={i < range.periods.length - 1 ? `/sources?period=${range.periods[i + 1]}` : null}
          prevLabel="Previous month" nextLabel="Next month" />
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-8">
        <p className="flex shrink-0 items-baseline gap-2">
          <span className="text-[26px] leading-none font-semibold tracking-[-0.02em]">{src.arrived} of {src.total}</span>
          <span className="text-[13px] text-ink-2">sources received for {month}</span>
        </p>
        <div className="flex flex-1 flex-col gap-2">
          <SourceStrip sources={data.sources} size="lg" />
          <ul className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-ink-2">
            <li className="flex items-center gap-1.5"><CheckIcon className="size-[13px] text-ok" />{src.received.length} received</li>
            <li className="flex items-center gap-1.5"><WarnIcon className="size-[13px] text-warn-icon" />{src.warnings.length} received with warnings, {data.openIssues} open issues</li>
            <li className="flex items-center gap-1.5"><DashedRingIcon className="size-[13px] text-muted" />{src.missing.length} missing{src.missing.length > 0 && `, due ${data.dueLabel}`}</li>
          </ul>
        </div>
      </div>

      <SourcesBoard sources={data.sources} issues={data.issues} openIssues={data.openIssues} periodLabel={month}
        firstDayLabel={data.firstDayLabel} lastDayLabel={data.lastDayLabel} dueLabel={data.dueLabel} />
    </div>
  );
}
