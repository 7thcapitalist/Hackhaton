import type { Metadata } from "next";
import { journalBatch } from "@/close/common";
import { PeriodStepper } from "@/components/PeriodStepper";
import { PrintButton } from "@/components/PrintButton";
import { StatusBadge } from "@/components/StatusBadge";
import { CloseActions } from "@/components/close/CloseActions";
import { CloseStepper, StagePill } from "@/components/close/CloseProgress";
import { EvidencePanel } from "@/components/close/EvidencePanel";
import { ExceptionsPanel } from "@/components/close/ExceptionsPanel";
import { InvoiceCard, JournalPreview } from "@/components/close/JournalPreview";
import { SourceChecklist } from "@/components/close/SourceChecklist";
import { TieOutTable } from "@/components/close/TieOutTable";
import { PrintExpander, WorkbookUpload } from "@/components/close/WorkbookUpload";
import { stageOf } from "@/components/close/types";
import { formatStampFull } from "../_lib/format";
import { getDataRange, periodLabel, resolvePeriod } from "../_lib/data";
import { getCloseScreen } from "./data";

export const metadata: Metadata = { title: "Month-end Close – Mission Control" };

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const period = resolvePeriod(range, (await searchParams).period);
  const view = await getCloseScreen(range, period);
  const stage = stageOf(view);
  const label = periodLabel(period);
  const i = range.periods.indexOf(period);
  const batch = view.posting?.batch ?? journalBatch(period);
  const sourceNames = Object.fromEntries(view.sources.map(s => [s.sourceId, s.name]));
  const locked = stage === "posted";

  return (
    <div className="flex flex-col gap-5 px-4 pt-[26px] pb-10 sm:px-8">
      <PrintExpander />
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <p className="text-[12.5px] font-medium text-ink-3">
            Source reports → allocation rules → Business Central · {view.summary.sourcesReceived} of {view.summary.sourcesExpected} sources in
          </p>
          <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">Month-end Close · {label}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StagePill stage={stage} />
            <StatusBadge status="simulated" label="Synthetic data" />
            {view.approvedBy && (
              <span className="text-xs text-ink-3">Approved by {view.approvedBy}{view.approvedAt ? ` · ${formatStampFull(view.approvedAt)}` : ""}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap items-center gap-3">
            <div data-print-hide>
              <PeriodStepper label={label}
                prevHref={i > 0 ? `/close?period=${range.periods[i - 1]}` : null}
                nextHref={i < range.periods.length - 1 ? `/close?period=${range.periods[i + 1]}` : null}
                prevLabel="Previous month" nextLabel="Next month" />
            </div>
            <PrintButton />
          </div>
          <CloseActions period={period} stage={stage} can={view.can} openExceptions={view.summary.openExceptions} defaultBatch={batch} />
        </div>
      </div>

      <CloseStepper steps={view.steps ?? []} derived={view.stepsDerived} />

      <SourceChecklist sources={view.sources} exceptions={view.exceptions} period={period} />

      <div className="flex flex-col gap-3">
        <TieOutTable view={view} />
        <WorkbookUpload period={period} workbook={view.workbook} disabled={locked} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <JournalPreview documents={view.documents} batch={batch} />
        <InvoiceCard invoice={view.invoice} />
      </div>

      <ExceptionsPanel exceptions={view.exceptions} sourceNames={sourceNames} locked={locked} />

      <EvidencePanel view={view} period={period} batch={batch} />

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-3 text-xs text-ink-3">
        <span>Amounts in USD, Business Central sign (+ debit, − credit). TBC = placeholder account still to confirm with Goodwill finance. Synthetic demo data.</span>
        <span>Data as of {formatStampFull(range.lastImportAt)}</span>
      </footer>
    </div>
  );
}
