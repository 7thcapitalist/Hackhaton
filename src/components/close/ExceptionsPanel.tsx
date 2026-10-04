"use client";
import { useId, useState } from "react";
import { formatMoney, formatStamp } from "@/app/_lib/format";
import type { CloseExceptionView } from "@/close";
import { Button } from "../Button";
import { CheckIcon, TeamIcon, WarnIcon } from "../icons";
import { patchException, useAction } from "./api";

const KIND: Record<string, string> = {
  missing_source: "Missing source",
  reconcile_mismatch: "Doesn't tie out",
  unbalanced_document: "Unbalanced document",
  unmapped_amount: "No GL rule",
  parse_warning: "File warning",
  duplicate_order: "Duplicate order",
};

type Props = { exceptions: CloseExceptionView[]; sourceNames: Record<string, string>; locked: boolean };

/** Owned exceptions (slide 42: "route exceptions to named owners"), grouped by owner. */
export function ExceptionsPanel({ exceptions, sourceNames, locked }: Props) {
  const [showClosed, setShowClosed] = useState(false);
  const open = exceptions.filter(e => e.status === "open");
  const closed = exceptions.filter(e => e.status !== "open");
  const shown = showClosed ? exceptions : open;
  const byOwner = new Map<string, CloseExceptionView[]>();
  for (const e of shown) byOwner.set(e.owner ?? "Unassigned", [...(byOwner.get(e.owner ?? "Unassigned") ?? []), e]);

  return (
    <section aria-labelledby="exc-h" className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5">
        <h2 id="exc-h" className="text-sm font-semibold">Exceptions</h2>
        <div className="flex items-center gap-3 text-xs text-ink-3">
          <span>{open.length} open · {closed.length} closed</span>
          {closed.length > 0 && (
            <label data-print-hide className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="accent-[var(--accent)]" />
              Show closed
            </label>
          )}
        </div>
      </header>
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3.5 text-[13px] text-ink-2">
          <CheckIcon className="size-3.5 text-ok" />{exceptions.length ? "No open exceptions." : "No exceptions for this close yet. Reconcile to run the checks."}
        </p>
      ) : (
        [...byOwner.entries()].map(([owner, list]) => (
          <div key={owner} className="border-b border-line-2 last:border-b-0">
            <p className="flex items-center gap-1.5 bg-surface-2 px-4 py-1.5 text-[11.5px] font-semibold text-ink-2">
              <TeamIcon className="size-3" />{owner}<span className="font-normal text-ink-3">· {list.filter(e => e.status === "open").length} open</span>
            </p>
            <ul>{list.map(e => <ExceptionItem key={e.id} e={e} sourceName={e.sourceId ? sourceNames[e.sourceId] ?? e.sourceId : null} locked={locked} />)}</ul>
          </div>
        ))
      )}
    </section>
  );
}

function ExceptionItem({ e, sourceName, locked }: { e: CloseExceptionView; sourceName: string | null; locked: boolean }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const noteId = useId();
  const act = async (status: "resolved" | "waived" | "open") => {
    if (await run(status, () => patchException(e.id, status, note))) { setNote(""); setEditing(false); }
  };
  const isOpen = e.status === "open";
  const amounts = e.expectedCents != null || e.actualCents != null;

  return (
    <li className="flex flex-col gap-2 border-t border-line-2 px-4 py-3 first:border-t-0">
      <div className="flex gap-2.5">
        {isOpen ? <WarnIcon className="mt-0.5 size-3.5 shrink-0 text-warn-icon" /> : <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-ok" />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-3">
            <span className="font-semibold text-ink-2">{KIND[e.kind] ?? e.kind}</span>
            {sourceName && <span>{sourceName}</span>}
            {!isOpen && <span className="rounded-[4px] bg-muted-soft px-1.5 font-medium text-muted capitalize">{e.status}{e.resolvedAt ? ` ${formatStamp(e.resolvedAt, { month: "short", day: "numeric" })}` : ""}</span>}
          </p>
          <p className={`text-[13px] text-pretty whitespace-pre-line ${isOpen ? "" : "text-ink-3"}`}>{e.message}</p>
          {amounts && (
            <p className="text-xs text-ink-3">
              Expected {e.expectedCents == null ? "—" : formatMoney(e.expectedCents)} · got {e.actualCents == null ? "—" : formatMoney(e.actualCents)}
              {e.expectedCents != null && e.actualCents != null && <> · <span className="font-semibold text-bad">Δ {formatMoney(e.actualCents - e.expectedCents)}</span></>}
            </p>
          )}
        </div>
      </div>
      {!locked && (
        <div data-print-hide className="flex flex-col gap-2 pl-6">
          {editing && (
            <label htmlFor={noteId} className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Note (saved with the exception)
              <textarea id={noteId} value={note} onChange={ev => setNote(ev.target.value)} rows={2} placeholder="Why it's resolved or waived"
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-accent" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {isOpen ? (
              <>
                <Button className="h-8 text-[12.5px]" disabled={!!busy} onClick={() => act("resolved")}>{busy === "resolved" ? "Saving…" : "Resolve"}</Button>
                <Button className="h-8 text-[12.5px]" disabled={!!busy} onClick={() => act("waived")}>{busy === "waived" ? "Saving…" : "Waive"}</Button>
                {!editing && <Button variant="ghost" className="h-8 text-[12.5px]" onClick={() => setEditing(true)}>Add note</Button>}
              </>
            ) : (
              <Button variant="ghost" className="h-8 text-[12.5px]" disabled={!!busy} onClick={() => act("open")}>Reopen</Button>
            )}
          </div>
          {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        </div>
      )}
    </li>
  );
}
