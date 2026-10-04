"use client";
import { CheckIcon, WarnIcon } from "@/components/icons";
import { SourceTile } from "@/components/SourceTile";
import type { Source, SourceIssue } from "../_lib/types";

type SourcesBoardProps = {
  sources: Source[];
  issues: SourceIssue[];
  openIssues: number;
  periodLabel: string;
  firstDayLabel: string;
  lastDayLabel: string;
  dueLabel: string;
};

export function SourcesBoard({ sources, issues, openIssues, periodLabel, firstDayLabel, lastDayLabel, dueLabel }: SourcesBoardProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map(s => (
          <SourceTile key={s.id} source={s} periodLabel={periodLabel} firstDayLabel={firstDayLabel} lastDayLabel={lastDayLabel} dueLabel={dueLabel} />
        ))}
      </div>

        <section id="issues" className="flex scroll-mt-4 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <header className="flex items-center justify-between border-b border-line px-4 py-3.5">
            <h2 className="text-sm font-semibold">Open issues</h2>
            <span className="text-xs text-ink-3">{openIssues} open</span>
          </header>
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-ink-2"><CheckIcon className="size-3.5 text-ok" />No open issues for {periodLabel}.</p>
          ) : (
            <ul>
              {issues.map(i => (
                <li key={`${i.source}-${i.text}`} className="flex gap-2.5 border-b border-line-2 px-4 py-3 last:border-b-0">
                  <WarnIcon className="mt-0.5 size-3.5 shrink-0 text-warn-icon" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-pretty">{i.text}</span>
                    <span className="line-clamp-2 text-xs text-ink-3" title={i.detail}>{i.source} · {i.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
    </div>
  );
}
