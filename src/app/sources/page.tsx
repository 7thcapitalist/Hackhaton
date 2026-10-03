import type { Metadata } from "next";
import { CheckIcon, DashedRingIcon, WarnIcon } from "@/components/icons";
import { PeriodStepper } from "@/components/PeriodStepper";
import { SourceStrip } from "@/components/SourceStrip";
import { SourcesBoard } from "./SourcesBoard";
import { SCORECARD_PERIOD_ID, SOURCES_DUE, getPeriodMeta, getSourceIssues, getSources, getSourceSummary } from "../_lib/live-data";

export const metadata: Metadata = { title: "Data Sources – Mission Control" };

export default async function SourcesPage() {
  const [period, sources, issues, src] = await Promise.all([
    getPeriodMeta(SCORECARD_PERIOD_ID),
    getSources(SCORECARD_PERIOD_ID),
    getSourceIssues(SCORECARD_PERIOD_ID),
    getSourceSummary(SCORECARD_PERIOD_ID),
  ]);
  const periodLabel = period.label;
  const short = period.short;
  const month = periodLabel.split(" ")[0];
  const lastDay = +period.dataThrough.split(" ")[1]!;

  return (
    <div className="flex flex-col gap-5 px-4 pt-7 pb-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <p className="text-[12.5px] font-medium text-ink-3">{src.total} sources · imported nightly at 6:00 AM ET</p>
          <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">Data Sources</h1>
        </div>
        <PeriodStepper label={periodLabel} prevHref={null} nextHref={null} prevLabel="Previous month" nextLabel="Next month" />
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-[22px] py-[18px] shadow-xs md:flex-row md:items-center md:gap-7">
        <p className="flex shrink-0 items-baseline gap-2.5">
          <span className="text-4xl leading-none font-semibold tracking-[-0.03em]">{src.arrived} of {src.total}</span>
          <span className="text-sm text-ink-2">sources received for {month}</span>
        </p>
        <div className="flex flex-1 flex-col gap-2">
          <SourceStrip sources={sources} size="lg" />
          <ul className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-ink-2">
            <li className="flex items-center gap-1.5"><CheckIcon className="size-[13px] text-ok" />{src.received.length} received</li>
            <li className="flex items-center gap-1.5"><WarnIcon className="size-[13px] text-warn-icon" />{src.warnings.length} received with warnings · {src.openIssues} open issues</li>
            <li className="flex items-center gap-1.5"><DashedRingIcon className="size-[13px] text-muted" />{src.missing.length} missing · due {SOURCES_DUE}</li>
          </ul>
        </div>
      </div>

      <SourcesBoard sources={sources} issues={issues} periodLabel={month} firstDayLabel={`${short} 1`} lastDayLabel={`${short} ${lastDay}`} dueLabel={SOURCES_DUE} />
    </div>
  );
}
