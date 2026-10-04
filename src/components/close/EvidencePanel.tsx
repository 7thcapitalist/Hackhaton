import { formatStampFull } from "@/app/_lib/format";
import { buttonClass } from "../Button";
import { CheckIcon, DashedRingIcon, DownloadIcon } from "../icons";
import { STAGES, STAGE_LABEL, stageOf, type AuditEvent, type CloseStage, type UiCloseView } from "./types";

const ACTION_STAGE: Record<string, CloseStage> = {
  generate: "generated", generated: "generated", reconcile: "reconciled", reconciled: "reconciled",
  approve: "approved", approved: "approved", export: "exported", exported: "exported",
  mark_imported: "imported", imported: "imported", mark_posted: "posted", posted: "posted",
};

/** Audit trail from the view's own `audit` events, or pieced together from the close's fields. */
function auditOf(v: UiCloseView): { stage: CloseStage; by: string | null; at: string | null; detail?: string | null; reached: boolean }[] {
  const reachedIdx = STAGES.indexOf(stageOf(v));
  const steps = STAGES.slice(1);
  if (v.audit?.length) {
    const last = new Map<CloseStage, AuditEvent>();
    for (const e of v.audit) { const s = ACTION_STAGE[e.action]; if (s) last.set(s, e); }
    return steps.map(s => ({ stage: s, by: last.get(s)?.by ?? null, at: last.get(s)?.at ?? null, detail: last.get(s)?.detail, reached: STAGES.indexOf(s) <= reachedIdx || last.has(s) }));
  }
  const known: Partial<Record<CloseStage, { by: string | null; at: string | null }>> = {
    generated: { by: null, at: v.generatedAt ?? null },
    reconciled: { by: null, at: v.reconciledAt ?? null },
    approved: { by: v.approvedBy, at: v.approvedAt },
    exported: { by: null, at: v.exportedAt ?? null },
    imported: { by: v.posting?.importedBy ?? null, at: v.posting?.importedAt ?? null },
    posted: { by: v.posting?.postedBy ?? null, at: v.posting?.postedAt ?? null },
  };
  return steps.map(s => ({ stage: s, by: known[s]?.by ?? null, at: known[s]?.at ?? null, reached: STAGES.indexOf(s) <= reachedIdx }));
}

export function EvidencePanel({ view, period, batch }: { view: UiCloseView; period: string; batch: string }) {
  const trail = auditOf(view);
  const p = view.posting;
  const docNos = p?.documentNos?.length ? p.documentNos : view.documents.map(d => d.documentNo);

  return (
    <section aria-labelledby="ev-h" className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ev-h" className="text-sm font-semibold">Evidence and audit trail</h2>
          {view.evidenceUrl ? (
            <a data-print-hide href={view.evidenceUrl} className={buttonClass("secondary", "h-8 text-[12.5px]")}><DownloadIcon />Download evidence package</a>
          ) : (
            <span data-print-hide className={buttonClass("secondary", "h-8 cursor-not-allowed text-[12.5px] opacity-45")} aria-disabled="true"
              title={`Coming soon: GET /api/close/${period}/evidence`}>
              <DownloadIcon />Evidence package · coming soon
            </span>
          )}
        </header>
        <ol className="flex flex-col">
          {trail.map((t, i) => (
            <li key={t.stage} className="relative flex gap-3 pb-3 last:pb-0">
              {i < trail.length - 1 && <span aria-hidden className={`absolute top-[18px] bottom-0 left-[8.5px] w-px ${t.reached ? "bg-ok" : "bg-line"}`} />}
              <span className={`z-10 grid size-[18px] shrink-0 place-items-center rounded-full ${t.reached ? "bg-ok text-surface" : "border border-line bg-surface text-ink-4"}`} aria-hidden>
                {t.reached ? <CheckIcon className="size-2.5" /> : <DashedRingIcon className="size-2.5" />}
              </span>
              <div className="flex min-w-0 flex-col">
                <p className={`text-[13px] font-medium ${t.reached ? "" : "text-ink-3"}`}>{STAGE_LABEL[t.stage]}<span className="sr-only">{t.reached ? " — done" : " — not yet"}</span></p>
                <p className="text-xs text-ink-3">
                  {t.reached
                    ? [t.by ? `by ${t.by}` : null, t.at ? formatStampFull(t.at) : "time not recorded"].filter(Boolean).join(" · ")
                    : "Not yet"}
                  {t.detail ? ` · ${t.detail}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Business Central posting</h3>
          {p?.simulated !== false && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft py-0.5 pr-2 pl-1.5 text-[11.5px] font-semibold text-warn">
              <span className="size-1.5 rotate-45 rounded-[1px] bg-warn-icon" />Simulated
            </span>
          )}
        </header>
        {!p ? (
          <p className="text-[13px] text-pretty text-ink-2">
            Posting status will appear here once the close module records imports into Business Central. Until then the exported journal is pasted into BC by hand.
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-ink-3">Status</dt>
          <dd className="font-medium capitalize">{p ? p.status.replace(/_/g, " ") : STAGE_LABEL[stageOf(view)]}</dd>
          <dt className="text-ink-3">Journal batch</dt>
          <dd className="font-mono">{p?.batch ?? batch}</dd>
          <dt className="text-ink-3">Document numbers</dt>
          <dd className="flex flex-wrap gap-1">
            {docNos.length ? docNos.map(n => <span key={n} className="rounded-[5px] border border-line bg-surface-2 px-1.5 font-mono text-[11.5px]">{n}</span>) : <span className="text-ink-3">—</span>}
          </dd>
          <dt className="text-ink-3">Posted</dt>
          <dd>{p?.postedAt ? `${formatStampFull(p.postedAt)}${p.postedBy ? ` · ${p.postedBy}` : ""}` : <span className="text-ink-3">Not yet</span>}</dd>
        </dl>
        <p className="mt-auto text-[11.5px] text-pretty text-ink-3">
          Demo: no connection to a real Business Central tenant. Imports and postings are recorded here, not sent.
        </p>
      </div>
    </section>
  );
}
