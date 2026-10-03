"use client";
import { useRef, useState } from "react";
import { FileIcon, WarnIcon } from "@/components/icons";
import { SourceTile } from "@/components/SourceTile";
import { UploadZone, type UploadZoneHandle } from "@/components/UploadZone";
import type { Source, SourceIssue } from "../_lib/types";

type SourcesBoardProps = {
  sources: Source[];
  issues: SourceIssue[];
  periodLabel: string;
  firstDayLabel: string;
  lastDayLabel: string;
  dueLabel: string;
};

export function SourcesBoard({ sources, issues, periodLabel, firstDayLabel, lastDayLabel, dueLabel }: SourcesBoardProps) {
  const [queued, setQueued] = useState<string[]>([]);
  const zone = useRef<UploadZoneHandle>(null);
  // Ingest (parse + validate) is Joao's lane: POST these to the ingest route once it exists.
  const add = (files: File[]) => setQueued(q => [...q, ...files.map(f => f.name)]);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map(s => (
          <SourceTile key={s.id} source={s} periodLabel={periodLabel} firstDayLabel={firstDayLabel} lastDayLabel={lastDayLabel} dueLabel={dueLabel}
            onUpload={() => zone.current?.browse()} />
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        <UploadZone ref={zone} onFiles={add} />
        {queued.length > 0 && (
          <ul className="flex flex-col gap-2" aria-live="polite">
            {queued.map((name, i) => (
              <li key={`${name}-${i}`} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px]">
                <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-accent-soft text-accent"><FileIcon /></span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{name}</span>
                  <span className="text-ink-3">Queued for import</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <section id="issues" className="flex scroll-mt-4 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <header className="flex items-center justify-between border-b border-line px-4 py-3.5">
            <h2 className="text-sm font-semibold">Open issues</h2>
            <span className="text-xs text-ink-3">{issues.length} · none block totals</span>
          </header>
          <ul>
            {issues.map(i => (
              <li key={i.text} className="flex gap-2.5 border-b border-line-2 px-4 py-3 last:border-b-0">
                <WarnIcon className="mt-0.5 size-3.5 shrink-0 text-warn-icon" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-pretty">{i.text}</span>
                  <span className="truncate text-xs text-ink-3">{i.source} · <span className="font-mono">{i.file}</span></span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
