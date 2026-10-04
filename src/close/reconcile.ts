/**
 * Close checks. Runs after generateClose (and on demand, after a workbook
 * import, and after posting) and writes exceptions linked to the close, each
 * with an owner (the source's owner, else Accounting):
 *
 * - unbalanced_document: per Document No., Σ amount of lines without their
 *   own Bal. Account No. must be 0 (BC rule, research.md §1).
 * - reconcile_mismatch (Goodwill Books): AR invoice total vs the statement's
 *   `statement_payment` control total for the period.
 * - reconcile_mismatch (tie-out, see tieout.ts), one exception per source:
 *     journal vs the source facts recomputed through the GL rules;
 *     journal vs the `workbook_baseline` (prior allocation workbook output,
 *       slide 42 "reproduce + validate"), when a baseline is loaded;
 *     posted totals (BC response) vs the journal, once posted.
 *   Amounts must agree to the cent (differences of $0.01 or more count).
 * - missing_source: active sources with no file for the period
 *   (checkCompleteness from @/ingest).
 *
 * Re-running replaces this module's own exceptions for the close
 * (unbalanced_document, reconcile_mismatch, missing_source), BUT a
 * re-raised exception identical to one already resolved or waived (same kind,
 * source, amounts and base message) keeps that resolution, so a reviewer's
 * decision survives a re-run. `unmapped_amount` exceptions belong to the
 * engine and are only replaced on regenerate.
 *
 * Status: `reconciled` when the close has no OPEN exception of any kind;
 * otherwise `generated`. An approved or exported close keeps its status.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  arInvoiceLines,
  arInvoices,
  closes,
  exceptions,
  journalLines,
  moneyLines,
  sources,
  type NewDataException,
} from "@/db/schema";
import { checkCompleteness } from "@/ingest";
import { INVOICE_SOURCE } from "./gl-rules";
import { appendEvent, assertPeriod, fmtUsd, requireClose } from "./common";
import { computeTieOut, differs, UNMAPPED_ACCOUNT, type TieOutRow } from "./tieout";

export type CheckStatus = "pass" | "fail" | "skipped";

export interface ReconcileCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ReconcileResult {
  period: string;
  status: string;
  checks: ReconcileCheck[];
  openExceptions: number;
}

const OWN_KINDS = ["unbalanced_document", "reconcile_mismatch", "missing_source"] as const;

/** The message as raised, without notes appended by resolve/waive. */
const baseMessage = (m: string) => m.split("\n[")[0].split(" [Waived at approval")[0].split(" [Resolved by ")[0].split(" [Waived by ")[0];
const matchKey = (e: { kind: string; sourceId?: string | null; expectedCents?: number | null; actualCents?: number | null; message: string }) =>
  [e.kind, e.sourceId ?? "", e.expectedCents ?? "", e.actualCents ?? "", baseMessage(e.message)].join("|");

export async function reconcileClose(period: string, opts: { db?: Db; by?: string } = {}): Promise<ReconcileResult> {
  assertPeriod(period);
  const db = opts.db ?? getDb();
  const close = await requireClose(db, period);
  const closeId = close.id;

  const [lines, invoices, sourceRows] = await Promise.all([
    db.select().from(journalLines).where(eq(journalLines.closeId, closeId)),
    db.select().from(arInvoices).where(eq(arInvoices.closeId, closeId)),
    db.select({ id: sources.id, name: sources.name, owner: sources.owner }).from(sources),
  ]);
  const invLines = invoices.length
    ? await db.select().from(arInvoiceLines).where(inArray(arInvoiceLines.invoiceId, invoices.map((i) => i.id)))
    : [];
  const name = (id: string | null) => sourceRows.find((s) => s.id === id)?.name ?? id ?? "?";
  const owner = (id: string | null) => sourceRows.find((s) => s.id === id)?.owner ?? "Accounting";

  const exc: NewDataException[] = [];
  const checks: ReconcileCheck[] = [];
  const push = (e: Omit<NewDataException, "id" | "closeId" | "status">) =>
    exc.push({ id: randomUUID(), closeId, status: "open", ...e });

  // ---- 1. Each document balances ------------------------------------------
  const docs = new Map<string, typeof lines>();
  for (const l of lines) docs.set(l.documentNo, [...(docs.get(l.documentNo) ?? []), l]);
  let unbalanced = 0;
  for (const [docNo, ls] of docs) {
    const net = ls.filter((l) => !l.balAccountNo).reduce((s, l) => s + l.amountCents, 0);
    if (net !== 0) {
      unbalanced++;
      push({
        sourceId: ls[0].sourceId,
        kind: "unbalanced_document",
        message: `Document ${docNo} does not balance: lines net to ${fmtUsd(net)} (debits must equal credits). Add a clearing rule for ${name(ls[0].sourceId)}.`,
        expectedCents: 0,
        actualCents: net,
        owner: "Accounting",
      });
    }
  }
  checks.push({
    key: "documents_balance",
    label: "Every journal document balances",
    status: docs.size === 0 ? "skipped" : unbalanced ? "fail" : "pass",
    detail: docs.size === 0 ? "No journal lines." : `${docs.size - unbalanced}/${docs.size} documents balance.`,
  });

  // ---- 2. Goodwill Books invoice vs statement payment ----------------------
  const stmt = await db
    .select({ amount: moneyLines.amountCents })
    .from(moneyLines)
    .where(and(eq(moneyLines.period, period), eq(moneyLines.sourceId, INVOICE_SOURCE), eq(moneyLines.amountType, "statement_payment")));
  const invoiceTotal = invLines.reduce((s, l) => s + Math.round(l.unitPriceCents * l.quantity), 0);
  if (stmt.length === 0 && invLines.length === 0) {
    checks.push({ key: "goodwill_books_statement", label: "Goodwill Books invoice = statement payment", status: "skipped", detail: "No Goodwill Books data for the period." });
  } else {
    const expected = stmt.length ? stmt.reduce((s, r) => s + r.amount, 0) : null;
    const ok = expected !== null && expected === invoiceTotal;
    if (!ok) {
      push({
        sourceId: INVOICE_SOURCE,
        kind: "reconcile_mismatch",
        message:
          expected === null
            ? `Goodwill Books: invoice totals ${fmtUsd(invoiceTotal)} but no statement payment (control total) was found for ${period}.`
            : `Goodwill Books: AR invoice totals ${fmtUsd(invoiceTotal)} but the statement payment is ${fmtUsd(expected)} (difference ${fmtUsd(invoiceTotal - expected)}).`,
        expectedCents: expected,
        actualCents: invoiceTotal,
        owner: owner(INVOICE_SOURCE),
      });
    }
    checks.push({
      key: "goodwill_books_statement",
      label: "Goodwill Books invoice = statement payment",
      status: ok ? "pass" : "fail",
      detail: `Invoice ${fmtUsd(invoiceTotal)} vs statement ${expected === null ? "missing" : fmtUsd(expected)}.`,
    });
  }

  // ---- 3. Tie-out: source facts → journal → workbook → posted ---------------
  const tie = await computeTieOut(db, close);
  const groupBySource = (pick: (r: TieOutRow) => number | null, skip?: (r: TieOutRow) => boolean) => {
    const m = new Map<string, TieOutRow[]>();
    for (const r of tie.rows) {
      if (skip?.(r) || !differs(pick(r))) continue;
      m.set(r.sourceId, [...(m.get(r.sourceId) ?? []), r]);
    }
    return m;
  };
  const acct = (r: TieOutRow) => `${r.accountNo}${r.deptCodes ? ` dept ${r.deptCodes}` : ""}`;
  /** One exception per source; expected/actual = the account with the largest difference. */
  const pushGroup = (
    sourceId: string,
    rs: TieOutRow[],
    pick: (r: TieOutRow) => number | null,
    expectedOf: (r: TieOutRow) => number,
    title: string,
    describe: (r: TieOutRow) => string,
    hint: string,
  ) => {
    const main = [...rs].sort((a, b) => Math.abs(pick(b) ?? 0) - Math.abs(pick(a) ?? 0))[0];
    push({
      sourceId,
      kind: "reconcile_mismatch",
      message: `${name(sourceId)}: ${title} on ${rs.length} account(s): ${rs.map(describe).join("; ")}. ${hint}`.slice(0, 1000),
      expectedCents: expectedOf(main),
      actualCents: main.journalCents,
      owner: owner(sourceId),
    });
  };

  // 3a. Journal vs the facts (unmapped amounts are the engine's own exception).
  const srcDiffs = groupBySource((r) => r.sourceDiffCents, (r) => r.accountNo === UNMAPPED_ACCOUNT);
  for (const [sourceId, rs] of srcDiffs) {
    pushGroup(
      sourceId,
      rs,
      (r) => r.sourceDiffCents,
      (r) => r.sourceCents,
      "journal does not tie to the source facts",
      (r) => `${acct(r)} facts ${fmtUsd(r.sourceCents)} vs journal ${fmtUsd(r.journalCents)} (diff ${fmtUsd(r.sourceDiffCents)})`,
      "GL rules may have changed since generation: regenerate the close.",
    );
  }
  checks.push({
    key: "journal_ties_to_sources",
    label: "Journal ties to the source facts",
    status: lines.length + invLines.length === 0 ? "skipped" : srcDiffs.size ? "fail" : "pass",
    detail: srcDiffs.size
      ? `${[...srcDiffs.values()].flat().length} account(s) in ${srcDiffs.size} source(s) differ from the facts.`
      : `${tie.rows.filter((r) => r.accountNo !== UNMAPPED_ACCOUNT).length} source/account totals tie to the cent.`,
  });

  // 3b. Journal vs the allocation workbook (slide 42 "reproduce + validate").
  if (!tie.workbookLoaded) {
    checks.push({ key: "workbook_baseline", label: "Matches the allocation workbook", status: "skipped", detail: "No workbook baseline loaded for the period." });
  } else {
    const wbDiffs = groupBySource((r) => r.workbookDiffCents);
    for (const [sourceId, rs] of wbDiffs) {
      pushGroup(
        sourceId,
        rs,
        (r) => r.workbookDiffCents,
        (r) => r.workbookCents ?? 0,
        "differs from the allocation workbook",
        (r) =>
          r.workbookCents === 0 && r.journalCents !== 0
            ? `${acct(r)} generated ${fmtUsd(r.journalCents)} but the workbook has no such line`
            : `${acct(r)} workbook ${fmtUsd(r.workbookCents ?? 0)} vs generated ${fmtUsd(r.journalCents)} (diff ${fmtUsd(r.workbookDiffCents ?? 0)})`,
        "Confirm which side is right, then resolve or waive with a note.",
      );
    }
    const compared = tie.rows.filter((r) => r.workbookCents !== null).length;
    const n = [...wbDiffs.values()].flat().length;
    checks.push({
      key: "workbook_baseline",
      label: "Matches the allocation workbook",
      status: wbDiffs.size ? "fail" : "pass",
      detail: `${tie.workbookRows} workbook line(s), ${compared} source/account total(s) compared, ${n} difference(s) in ${wbDiffs.size} source(s).`,
    });
  }

  // 3c. Posted in BC vs the journal.
  if (!tie.posted) {
    checks.push({
      key: "posted_matches",
      label: "Posted totals match the journal",
      status: "skipped",
      detail: `Not posted yet (posting status: ${close.postingStatus}).`,
    });
  } else {
    const postDiffs = groupBySource((r) => r.postedDiffCents, (r) => r.accountNo === UNMAPPED_ACCOUNT);
    for (const [sourceId, rs] of postDiffs) {
      pushGroup(
        sourceId,
        rs,
        (r) => r.postedDiffCents,
        (r) => r.postedCents ?? 0,
        "posted totals differ from the journal",
        (r) => `${acct(r)} posted ${fmtUsd(r.postedCents ?? 0)} vs journal ${fmtUsd(r.journalCents)}`,
        "Check the Business Central batch.",
      );
    }
    checks.push({
      key: "posted_matches",
      label: "Posted totals match the journal",
      status: postDiffs.size ? "fail" : "pass",
      detail: postDiffs.size ? `${postDiffs.size} source(s) differ from what BC posted.` : "Every account total BC posted matches the journal.",
    });
  }

  // ---- 4. Every source delivered a file ------------------------------------
  const completeness = await checkCompleteness({ period }, { db });
  for (const s of completeness.missingSources) {
    push({
      sourceId: s.id,
      kind: "missing_source",
      message: `No ${s.name} file ingested for the ${period} close.`,
      owner: owner(s.id),
    });
  }
  checks.push({
    key: "sources_complete",
    label: "Every source delivered a file",
    status: completeness.missingSources.length ? "fail" : "pass",
    detail: completeness.missingSources.length
      ? `Missing: ${completeness.missingSources.map((s) => s.name).join(", ")}.`
      : `${completeness.presentSources.length}/${completeness.expectedSources.length} sources received.`,
  });

  // ---- Write (keeping earlier resolutions) ----------------------------------
  await db.transaction(async (tx) => {
    const previous = await tx
      .select()
      .from(exceptions)
      .where(and(eq(exceptions.closeId, closeId), inArray(exceptions.kind, [...OWN_KINDS])));
    const decided = new Map(previous.filter((e) => e.status !== "open").map((e) => [matchKey(e), e]));
    for (const e of exc) {
      const old = decided.get(matchKey({ ...e, message: e.message }));
      if (!old) continue;
      e.status = old.status;
      e.resolvedAt = old.resolvedAt;
      e.message = old.message;
      e.owner = old.owner ?? e.owner;
      e.createdAt = old.createdAt;
    }
    await tx.delete(exceptions).where(and(eq(exceptions.closeId, closeId), inArray(exceptions.kind, [...OWN_KINDS])));
    if (exc.length) await tx.insert(exceptions).values(exc);
  });

  const open = await db
    .select({ id: exceptions.id, kind: exceptions.kind })
    .from(exceptions)
    .where(and(eq(exceptions.closeId, closeId), eq(exceptions.status, "open")));
  const unmapped = open.filter((e) => e.kind === "unmapped_amount").length;
  checks.unshift({
    key: "amounts_mapped",
    label: "Every amount has a GL rule",
    status: unmapped ? "fail" : "pass",
    detail: unmapped ? `${unmapped} amount group(s) have no GL rule and were not posted.` : "All amounts mapped.",
  });
  let status: string = close.status;
  if (close.status !== "approved" && close.status !== "exported") {
    status = open.length === 0 ? "reconciled" : "generated";
    await db.update(closes).set({ status: status as "reconciled" | "generated" }).where(eq(closes.id, closeId));
  }
  const failed = checks.filter((c) => c.status === "fail").map((c) => c.key);
  await appendEvent(db, closeId, {
    action: "reconciled",
    actor: opts.by ?? "system",
    detail: `${checks.length - failed.length}/${checks.length} checks not failing${failed.length ? ` (failed: ${failed.join(", ")})` : ""}; ${open.length} open exception(s)`,
  });
  return { period, status, checks, openExceptions: open.length };
}
