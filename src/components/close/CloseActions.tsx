"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "../Button";
import { CheckIcon, DownloadIcon, WarnIcon } from "../icons";
import { downloadExport, postClose, rememberName, rememberedName, useAction } from "./api";
import type { CloseCan, CloseStage } from "./types";

type Props = { period: string; stage: CloseStage; can: CloseCan; openExceptions: number; defaultBatch: string };

type Ask = null | "approve" | "force" | "imported" | "posted";

/** The one next step for this close, plus the few secondary ones that make sense now. */
export function CloseActions({ period, stage, can, openExceptions, defaultBatch }: Props) {
  const { busy, error, run } = useAction();
  const [ask, setAsk] = useState<Ask>(null);
  const [name, setName] = useState("");
  const [batch, setBatch] = useState(defaultBatch);
  const nameId = useId(), batchId = useId(), errId = useId();
  useEffect(() => setName(rememberedName()), []);

  const generate = (force = false) => run("generate", () => postClose(period, { action: "generate", ...(force ? { force: true } : {}) }));
  const reconcile = () => run("reconcile", () => postClose(period, { action: "reconcile" }));
  const exportAs = (f: "xlsx" | "csv") => run(`export-${f}`, () => downloadExport(period, f));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const who = name.trim();
    if (!who) return;
    rememberName(who);
    const body =
      ask === "approve" || ask === "force" ? { action: "approve", approvedBy: who, ...(ask === "force" ? { force: true } : {}) }
      : ask === "imported" ? { action: "mark_imported", by: who, batch: batch.trim() || defaultBatch }
      : { action: "mark_posted", by: who };
    if (await run(ask ?? "", () => postClose(period, body))) setAsk(null);
  };

  const soon = (label: string) => (
    <Button variant="primary" disabled title="Needs the Business Central posting step in the close API">{label} · coming soon</Button>
  );

  let primary;
  switch (stage) {
    case "collecting":
      primary = <Button variant="primary" disabled={!!busy || !can.generate} onClick={() => generate()}>{busy === "generate" ? "Generating…" : "Generate journal"}</Button>;
      break;
    case "generated":
      primary = <Button variant="primary" disabled={!!busy} onClick={reconcile}>{busy === "reconcile" ? "Reconciling…" : "Reconcile"}</Button>;
      break;
    case "reconciled":
      primary = <Button variant="primary" disabled={!!busy || !can.approve} onClick={() => setAsk("approve")} aria-expanded={ask === "approve"}>Approve close</Button>;
      break;
    case "approved":
    case "exported":
      primary = stage === "approved" || can.markImported === undefined ? (
        <span className="inline-flex">
          <Button variant="primary" className="rounded-r-none" disabled={!!busy || !can.export} icon={<DownloadIcon />} onClick={() => exportAs("xlsx")}>
            {busy === "export-xlsx" ? "Exporting…" : "Export journal (.xlsx)"}
          </Button>
          <Button variant="primary" className="rounded-l-none border-l-accent-ink/30 px-2.5" disabled={!!busy || !can.export} onClick={() => exportAs("csv")} aria-label="Export journal as CSV">CSV</Button>
        </span>
      ) : null;
      if (stage === "exported") {
        primary = can.markImported === undefined ? <>{primary}{soon("Mark imported to BC")}</>
          : <Button variant="primary" disabled={!!busy || !can.markImported} onClick={() => setAsk("imported")} aria-expanded={ask === "imported"}>Mark imported to BC</Button>;
      }
      break;
    case "imported":
      primary = can.markPosted === undefined ? soon("Mark posted")
        : <Button variant="primary" disabled={!!busy || !can.markPosted} onClick={() => setAsk("posted")} aria-expanded={ask === "posted"}>Mark posted</Button>;
      break;
    case "posted":
      primary = <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ok-soft px-3.5 text-[13px] font-semibold text-ok"><CheckIcon />Close posted</span>;
      break;
  }

  const secondary: { key: string; label: string; onClick: () => void; show: boolean }[] = [
    { key: "regen", label: busy === "generate" ? "Generating…" : "Regenerate", onClick: () => generate(), show: stage !== "collecting" && can.generate && ["generated", "reconciled", "approved"].includes(stage) },
    { key: "recon", label: busy === "reconcile" ? "Reconciling…" : "Re-run checks", onClick: reconcile, show: stage === "reconciled" || stage === "approved" },
    { key: "force", label: "Approve with open exceptions…", onClick: () => setAsk("force"), show: stage === "generated" && can.forceApprove },
    { key: "reexport", label: "Download journal again", onClick: () => exportAs("xlsx"), show: ["imported", "posted"].includes(stage) || (stage === "exported" && can.markImported !== undefined) },
  ];

  const askLabel = ask === "approve" ? "Approve as" : ask === "force" ? "Approve anyway as" : ask === "imported" ? "Imported by" : "Posted by";

  return (
    <div data-print-hide className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {secondary.filter(s => s.show).map(s => (
          <Button key={s.key} disabled={!!busy} onClick={s.onClick}>{s.label}</Button>
        ))}
        {primary}
      </div>

      {ask && (
        <form onSubmit={submit} className="flex w-full max-w-[460px] flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5 shadow-xs" aria-describedby={error ? errId : undefined}>
          {ask === "force" && (
            <p className="flex gap-2 text-[12.5px] text-pretty text-warn">
              <WarnIcon className="mt-0.5 size-3.5 shrink-0 text-warn-icon" />
              {openExceptions} open exception{openExceptions === 1 ? "" : "s"} will be marked waived under your name.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor={nameId} className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-ink-2">
              {askLabel}
              <input id={nameId} required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="name"
                className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-accent" />
            </label>
            {ask === "imported" && (
              <label htmlFor={batchId} className="flex w-[140px] flex-col gap-1 text-xs font-medium text-ink-2">
                BC journal batch
                <input id={batchId} value={batch} onChange={e => setBatch(e.target.value)} maxLength={10}
                  className="h-9 rounded-lg border border-line bg-surface px-2.5 font-mono text-[12.5px] text-ink focus-visible:outline-2 focus-visible:outline-accent" />
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAsk(null)} disabled={!!busy}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!!busy || !name.trim()}>{busy ? "Saving…" : "Confirm"}</Button>
          </div>
        </form>
      )}

      {error && <p id={errId} role="alert" className="max-w-[460px] text-[12.5px] text-pretty text-bad">{error}</p>}
    </div>
  );
}
