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
    <div className="flex flex-col gap-5 px-4 pt-7 pb-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <p className="text-[12.5px] font-medium text-ink-3">{src.total} sources · nightly and month-end files</p>
          <h1 className="font-display text-[34px] leading-[1.05] font-semibold sm:text-[38px]">Data Sources</h1>
        </div>
        <PeriodStepper label={label}
          prevHref={i > 0 ? `/sources?period=${range.periods[i - 1]}` : null}
          nextHref={i < range.periods.length - 1 ? `/sources?period=${range.periods[i + 1]}` : null}
          prevLabel="Previous month" nextLabel="Next month" />
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-[22px] py-[18px] shadow-xs md:flex-row md:items-center md:gap-7">
        <p className="flex shrink-0 items-baseline gap-2.5">
          <span className="font-display text-[44px] leading-none font-semibold">{src.arrived} of {src.total}</span>
          <span className="text-sm text-ink-2">sources received for {month}</span>
        </p>
        <div className="flex flex-1 flex-col gap-2">
          <SourceStrip sources={data.sources} size="lg" />
          <ul className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-ink-2">
            <li className="flex items-center gap-1.5"><CheckIcon className="size-[13px] text-ok" />{src.received.length} received</li>
            <li className="flex items-center gap-1.5"><WarnIcon className="size-[13px] text-warn-icon" />{src.warnings.length} received with warnings · {data.openIssues} open issues</li>
            <li className="flex items-center gap-1.5"><DashedRingIcon className="size-[13px] text-muted" />{src.missing.length} missing{src.missing.length > 0 && ` · due ${data.dueLabel}`}</li>
          </ul>
        </div>
      </div>

      <SourcesBoard sources={data.sources} issues={data.issues} openIssues={data.openIssues} periodLabel={month}
        firstDayLabel={data.firstDayLabel} lastDayLabel={data.lastDayLabel} dueLabel={data.dueLabel} />
    </div>
  );
}
