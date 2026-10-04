import { getCloseView } from "@/close";
import { getDb } from "@/db/client";
import { sources } from "@/db/schema";
import type { CloseStep, UiCloseView, UiSource } from "@/components/close/types";
import { stageOf } from "@/components/close/types";
import { getSourcesScreen, nextPeriod, type DataRange } from "../_lib/data";

/**
 * The close view plus the display extras the page needs: cadence and "not due yet"
 * from the Sources screen, and each source's owner. New view fields pass through as-is.
 */
export async function getCloseScreen(range: DataRange, period: string): Promise<UiCloseView & { stepsDerived: boolean }> {
  const [view, screen, owners] = await Promise.all([
    getCloseView(period) as Promise<unknown> as Promise<UiCloseView>,
    getSourcesScreen(range, period),
    getDb().select({ id: sources.id, owner: sources.owner }).from(sources),
  ]);
  // A monthly file (e.g. the Goodwill Books statement) is not due until the 5th of the next month.
  const beforeMonthlyDue = new Date().toISOString().slice(0, 10) < `${nextPeriod(period)}-05`;
  const byId = new Map(screen.sources.map(s => [s.id, s]));
  const ownerOf = new Map(owners.map(o => [o.id, o.owner]));
  const merged: UiSource[] = view.sources.map(s => {
    const screenSource = byId.get(s.sourceId);
    return {
      ...s,
      owner: s.owner ?? ownerOf.get(s.sourceId) ?? null,
      cadence: s.cadence ?? screenSource?.cadence,
      status: s.status === "missing" && (screenSource?.status === "not_due" || (beforeMonthlyDue && screenSource?.cadence === "monthly")) ? "not_due" : s.status,
    };
  });
  // The close module reports its audit trail as auditTrail[{at, action, actor, detail}]; the page reads audit[{action, by, at, detail}].
  const trail = (view as { auditTrail?: { at: string; action: string; actor: string | null; detail?: string | null }[] }).auditTrail;
  const audit = view.audit ?? trail?.map(e => ({ action: e.action, by: e.actor, at: e.at, detail: e.detail ?? null }));
  const out = { ...view, sources: merged, audit };
  const own = !!out.steps?.length;
  return { ...out, steps: own ? out.steps : deriveSteps(out), stepsDerived: !own };
}

/**
 * Slide 40's six steps, worked out from the base view when the close module does
 * not send its own `steps` yet. Each gets a one-line, plain-words detail.
 */
function deriveSteps(v: UiCloseView): CloseStep[] {
  const stage = stageOf(v);
  const due = v.sources.filter(s => s.status !== "not_due");
  const received = due.filter(s => s.status !== "missing").length;
  const files = v.sources.reduce((n, s) => n + s.fileCount, 0);
  const warned = v.sources.filter(s => s.status === "warnings").length;
  const unmapped = v.exceptions.filter(e => e.kind === "unmapped_amount" && e.status === "open").length;
  const generated = v.summary.documents > 0;
  const unbalanced = v.summary.documents - v.summary.balancedDocuments;
  const open = v.summary.openExceptions;
  return [
    {
      key: "acquire", label: "Acquire",
      status: received === due.length ? "done" : received > 0 ? "warning" : "todo",
      detail: `${received} of ${due.length} due sources received`,
    },
    {
      key: "archive", label: "Archive",
      status: files > 0 ? "done" : "todo",
      detail: files > 0 ? `${files} file${files === 1 ? "" : "s"} kept with run history` : "No files archived yet",
    },
    {
      key: "enrich", label: "Enrich",
      status: files === 0 ? "todo" : warned ? "warning" : "done",
      detail: files === 0 ? "Waiting for files" : warned ? `${warned} source${warned === 1 ? "" : "s"} with warnings` : "Source labels and period set",
    },
    {
      key: "rules", label: "Apply rules",
      status: !generated ? "todo" : unmapped ? "warning" : "done",
      detail: !generated ? "Not generated yet" : unmapped ? `${unmapped} amount group${unmapped === 1 ? "" : "s"} without a GL rule` : "Every amount has a GL rule",
    },
    {
      key: "output", label: "Create BC output",
      status: !generated ? "todo" : unbalanced ? "warning" : "done",
      detail: !generated ? "Journal and invoice not built" : `${v.summary.journalLines} journal lines, ${v.summary.balancedDocuments}/${v.summary.documents} balanced${v.invoice ? ", AR invoice ready" : ""}`,
    },
    {
      key: "post", label: "Post + reconcile",
      status: stage === "posted" ? "done" : generated && open ? "warning" : "todo",
      detail: stage === "posted" ? "Posted in Business Central" : !generated ? "Nothing to reconcile yet" : open ? `${open} open exception${open === 1 ? "" : "s"}` : stage === "collecting" || stage === "generated" ? "Run reconcile" : stage === "imported" ? "Imported to BC, awaiting posting" : stage === "exported" ? "Exported, awaiting BC import" : stage === "approved" ? "Approved, awaiting export" : "Reconciled, awaiting approval",
    },
  ];
}
