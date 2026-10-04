"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckIcon, FileIcon, WarnIcon } from "@/components/icons";
import { SourceTile } from "@/components/SourceTile";
import { UploadZone, type UploadZoneHandle } from "@/components/UploadZone";
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

type Upload = { key: string; name: string; state: "uploading" | "done" | "warn" | "error"; message: string };

/** Subset of IngestSummary (src/ingest) that the upload list shows. */
type IngestResult = { fileName: string; status: string; ordersInserted?: number; ordersReplaced?: number; warnings?: number; error?: string; sourceId?: string };

function describe(r: IngestResult): Pick<Upload, "state" | "message"> {
  if (r.status === "error") return { state: "error", message: r.error ?? "Could not import this file" };
  if (r.status === "duplicate") return { state: "warn", message: "Already imported; nothing changed" };
  const orders = `${r.ordersInserted ?? 0} orders imported${r.ordersReplaced ? `, ${r.ordersReplaced} replaced` : ""}`;
  return r.status === "parsed_with_warnings" ? { state: "warn", message: `${orders} · ${r.warnings} warning${r.warnings === 1 ? "" : "s"}` } : { state: "done", message: orders };
}

export function SourcesBoard({ sources, issues, openIssues, periodLabel, firstDayLabel, lastDayLabel, dueLabel }: SourcesBoardProps) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const zone = useRef<UploadZoneHandle>(null);

  // Ingest (detect source, parse, validate, store) is Joao's POST /api/ingest.
  const add = async (files: File[]) => {
    const batch = files.map(f => ({ key: `${f.name}-${f.lastModified}-${Math.random()}`, name: f.name, state: "uploading" as const, message: "Checking columns…" }));
    setUploads(u => [...batch, ...u]);
    await Promise.all(files.map(async (file, i) => {
      let result: Pick<Upload, "state" | "message">;
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/ingest", { method: "POST", body });
        result = describe((await res.json()) as IngestResult);
      } catch {
        result = { state: "error", message: "Upload failed; check your connection" };
      }
      setUploads(u => u.map(x => (x.key === batch[i].key ? { ...x, ...result } : x)));
    }));
    router.refresh();
  };

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
        {uploads.length > 0 && (
          <ul className="flex flex-col gap-2" aria-live="polite">
            {uploads.map(u => (
              <li key={u.key} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px]">
                <span className={`grid size-7 shrink-0 place-items-center rounded-[7px] ${
                  u.state === "done" ? "bg-ok-soft text-ok" : u.state === "warn" ? "bg-warn-soft text-warn-icon" : u.state === "error" ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent"}`}>
                  {u.state === "done" ? <CheckIcon /> : u.state === "uploading" ? <FileIcon /> : <WarnIcon />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{u.name}</span>
                  <span className={u.state === "error" ? "text-bad" : "text-ink-3"}>{u.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

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
    </div>
  );
}
