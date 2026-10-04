import Link from "next/link";
import { formatInt, formatStamp } from "@/app/_lib/format";
import { StatusBadge } from "../StatusBadge";
import { FileIcon } from "../icons";
import type { CloseExceptionView } from "@/close";
import type { UiSource } from "./types";

type Props = { sources: UiSource[]; exceptions: CloseExceptionView[]; period: string };

/** The month's source package: one row per source workflow (slide 38). */
export function SourceChecklist({ sources, exceptions, period }: Props) {
  const open = new Map<string, number>();
  for (const e of exceptions) if (e.status === "open" && e.sourceId) open.set(e.sourceId, (open.get(e.sourceId) ?? 0) + 1);
  const due = sources.filter(s => s.status !== "not_due");
  const received = due.filter(s => s.status !== "missing").length;

  return (
    <section aria-labelledby="pkg-h" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3.5">
        <h2 id="pkg-h" className="text-sm font-semibold">Source package</h2>
        <span className="text-xs text-ink-3">{received} of {due.length} due sources received{sources.length > due.length ? ` · ${sources.length - due.length} not due yet` : ""}</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[12.5px]">
          <thead className="text-[11.5px] text-ink-3">
            <tr className="border-b border-line-2">
              <th scope="col" className="px-4 py-2 font-medium">Source</th>
              <th scope="col" className="px-2 py-2 font-medium">Status</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Files</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Rows</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Open exceptions</th>
              <th scope="col" className="px-2 py-2 font-medium">Owner</th>
              <th scope="col" className="px-4 py-2 font-medium">Latest file</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(s => {
              const rows = s.files.filter(f => f.status !== "failed").reduce((n, f) => n + f.rowCount, 0);
              const exc = open.get(s.sourceId) ?? 0;
              const latest = s.files[0];
              const href = s.archiveUrl ?? latest?.archiveUrl ?? `/sources?period=${period}`;
              const external = !!(s.archiveUrl ?? latest?.archiveUrl);
              return (
                <tr key={s.sourceId} className="border-b border-line-2 last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 font-normal">
                    <span className="block font-semibold">{s.name}</span>
                    <span className="block text-[11.5px] text-ink-3">
                      {s.cadence ? `${s.cadence === "daily" ? "Daily" : "Monthly"} · ` : ""}{s.target === "invoice" ? "AR invoice" : "General journal"}
                    </span>
                  </th>
                  <td className="px-2 py-2.5"><StatusBadge status={s.status} count={s.warningCount} size="sm" /></td>
                  <td className="px-2 py-2.5 text-right">{s.fileCount || "—"}</td>
                  <td className="px-2 py-2.5 text-right">{rows ? formatInt(rows) : "—"}</td>
                  <td className={`px-2 py-2.5 text-right ${exc ? "font-semibold text-warn" : "text-ink-3"}`}>{exc || "—"}</td>
                  <td className="px-2 py-2.5">{s.owner ?? <span className="text-ink-3">Unassigned</span>}</td>
                  <td className="px-4 py-2.5">
                    {latest ? (
                      <Link href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} title={s.files.map(f => f.fileName).join("\n")}
                        className="inline-flex max-w-[240px] items-center gap-1.5 rounded text-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
                        <FileIcon className="size-3.5 shrink-0" />
                        <span className="truncate font-mono text-[11.5px]">{latest.fileName}</span>
                        {s.files.length > 1 && <span className="shrink-0 text-ink-3">+{s.files.length - 1}</span>}
                      </Link>
                    ) : (
                      <span className="text-ink-3">{s.status === "not_due" ? "Not due yet" : "No file"}</span>
                    )}
                    {latest && <span className="block text-[11px] text-ink-3">{formatStamp(latest.uploadedAt)} ET</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
