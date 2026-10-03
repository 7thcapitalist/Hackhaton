import type { Source } from "@/app/_lib/types";
import { formatInt, formatStamp } from "@/app/_lib/format";
import { StatusBadge } from "./StatusBadge";
import { UploadIcon } from "./icons";

type SourceTileProps = {
  source: Source;
  periodLabel: string;  // "September"
  firstDayLabel: string; // "Sep 1"
  lastDayLabel: string;  // "Sep 30"
  dueLabel: string;      // "Oct 5"
  onUpload?: (source: Source) => void;
};

export function SourceTile({ source: s, periodLabel, firstDayLabel, lastDayLabel, dueLabel, onUpload }: SourceTileProps) {
  const missing = s.status === "missing";
  const got = s.days?.filter(d => d !== "missing").length ?? 0; // days with warnings still arrived
  const last = s.lastImportAt
    ? `${formatStamp(s.lastImportAt, { month: "short", day: "numeric" })}, ${formatStamp(s.lastImportAt, { hour: "numeric", minute: "2-digit" })} ET`
    : s.lastFileLabel ?? "—";
  return (
    <article className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line p-4 shadow-xs ${missing ? "bg-surface-2" : "bg-surface"}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="text-sm font-semibold">{s.name}</h3><p className="truncate text-xs text-ink-3">{s.sublabel}</p></div>
        <StatusBadge status={s.status} count={s.openIssues} />
      </header>

      {s.cadence === "daily" && s.days ? (
        <div className="flex flex-col gap-[5px]">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${s.days.length}, minmax(0, 1fr))` }} role="img" aria-label={`${got} of ${s.days.length} days received`}>
            {s.days.map((d, i) => (
              <span key={i} className={`h-4 rounded-[2px] ${d === "received" ? "bg-ok" : d === "warning" ? "border border-warn-icon bg-warn-soft" : "border border-dashed border-ink-4"}`} />
            ))}
          </div>
          <p className="flex justify-between text-[11px] text-ink-3"><span>{firstDayLabel}</span><span>{got} of {s.days.length} days</span><span>{lastDayLabel}</span></p>
        </div>
      ) : (
        <p className={`flex min-h-[37px] flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-[7px] px-2.5 py-1.5 text-xs ${missing ? "border-[1.5px] border-dashed border-line text-ink-3" : "bg-ok-soft text-ok"}`}>
          <strong className="font-semibold whitespace-nowrap">Monthly file</strong>
          <span className="whitespace-nowrap">{missing ? `Not received · due ${dueLabel}` : `${periodLabel} received`}</span>
        </p>
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-xs">
        <dt className="text-ink-3">{missing ? "Last file" : "Last import"}</dt><dt className="text-right text-ink-3">Rows</dt>
        <dd className="font-medium">{last}</dd>
        <dd className="text-right font-medium">{s.rowCount == null ? "—" : formatInt(s.rowCount)}</dd>
      </dl>

      {s.formatUnconfirmed && (
        <p className="text-[11.5px] text-pretty text-ink-3" title="The importer reads this file, but its column layout hasn't been checked against a real export yet.">
          File format not yet confirmed with a real export
        </p>
      )}
      {s.status === "warnings" && (
        <a href="#issues" className="flex items-center justify-between gap-2 rounded-[7px] bg-warn-soft px-2.5 py-2 text-xs text-warn hover:brightness-95">
          <strong className="font-semibold">{s.openIssues} open issue{s.openIssues > 1 ? "s" : ""}</strong><span>Review →</span>
        </a>
      )}
      {missing && (
        <button type="button" onClick={() => onUpload?.(s)}
          className="flex h-8 items-center justify-center gap-[7px] rounded-lg border border-line bg-surface text-[12.5px] font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
          <UploadIcon className="size-[13px]" />Upload {s.name} file
        </button>
      )}
    </article>
  );
}
