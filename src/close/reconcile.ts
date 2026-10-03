/**
 * Close checks. Runs after generateClose (and on demand) and writes one
 * exception per problem, linked to the close:
 *
 * - unbalanced_document: per Document No., Σ amount of lines without their
 *   own Bal. Account No. must be 0 (BC rule, research.md §1).
 * - reconcile_mismatch (Goodwill Books): AR invoice total vs the statement's
 *   `statement_payment` control total for the period.
 * - reconcile_mismatch (workbook): journal totals per (source, account[, dept])
 *   vs `workbook_baseline` rows for the period, if any were loaded (slide 42
 *   "reproduce + validate"). Goodwill Books invoice lines are compared in BC
 *   sign (revenue = credit = negative). A baseline row with dept_code NULL is
 *   compared at account level. For a source that has baseline rows, any
 *   journal account the baseline does not list is a mismatch too (expected 0).
 * - missing_source: active sources with no file for the period
 *   (checkCompleteness from @/ingest).
 *
 * Re-running replaces this module's own exceptions for the close
 * (unbalanced_document, reconcile_mismatch, missing_source). `unmapped_amount`
 * exceptions belong to the engine and are only replaced on regenerate.
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
  workbookBaseline,
  type NewDataException,
} from "@/db/schema";
import { checkCompleteness } from "@/ingest";
import { INVOICE_SOURCE } from "./gl-rules";
import { assertPeriod, fmtUsd, requireClose } from "./common";

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

export async function reconcileClose(period: string, opts: { db?: Db } = {}): Promise<ReconcileResult> {
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

  // ---- 3. Workbook baseline -------------------------------------------------
  const baseline = await db.select().from(workbookBaseline).where(eq(workbookBaseline.period, period));
  if (baseline.length === 0) {
    checks.push({ key: "workbook_baseline", label: "Matches the allocation workbook", status: "skipped", detail: "No workbook baseline loaded for the period." });
  } else {
    // Actual amounts in BC sign per source|account|dept.
    const actual: { sourceId: string | null; accountNo: string; deptCode: string | null; cents: number }[] = [
      ...lines.map((l) => ({ sourceId: l.sourceId, accountNo: l.accountNo, deptCode: l.deptCode, cents: l.amountCents })),
      ...invLines.map((l) => ({ sourceId: INVOICE_SOURCE, accountNo: l.accountNo ?? "", deptCode: l.deptCode, cents: -Math.round(l.unitPriceCents * l.quantity) })),
    ];
    let mismatches = 0;
    const covered = new Set<string>();
    for (const b of baseline) {
      const match = actual.filter(
        (a) => a.sourceId === b.sourceId && a.accountNo === b.accountNo && (b.deptCode == null || a.deptCode === b.deptCode),
      );
      match.forEach((a) => covered.add(`${a.sourceId}|${a.accountNo}|${a.deptCode ?? ""}`));
      const got = match.reduce((s, a) => s + a.cents, 0);
      if (got !== b.amountCents) {
        mismatches++;
        push({
          sourceId: b.sourceId,
          kind: "reconcile_mismatch",
          message: `${name(b.sourceId)} account ${b.accountNo}${b.deptCode ? ` dept ${b.deptCode}` : ""}: workbook ${fmtUsd(b.amountCents)}, generated ${fmtUsd(got)} (difference ${fmtUsd(got - b.amountCents)}).`,
          expectedCents: b.amountCents,
          actualCents: got,
          owner: owner(b.sourceId),
        });
      }
    }
    const baselineSources = new Set(baseline.map((b) => b.sourceId));
    const extra = new Map<string, number>();
    for (const a of actual) {
      const k = `${a.sourceId}|${a.accountNo}|${a.deptCode ?? ""}`;
      if (!baselineSources.has(a.sourceId) || covered.has(k)) continue;
      extra.set(k, (extra.get(k) ?? 0) + a.cents);
    }
    for (const [k, cents] of extra) {
      if (!cents) continue;
      const [sourceId, accountNo, dept] = k.split("|");
      mismatches++;
      push({
        sourceId,
        kind: "reconcile_mismatch",
        message: `${name(sourceId)} account ${accountNo}${dept ? ` dept ${dept}` : ""}: generated ${fmtUsd(cents)} but the workbook has no such line.`,
        expectedCents: 0,
        actualCents: cents,
        owner: owner(sourceId),
      });
    }
    checks.push({
      key: "workbook_baseline",
      label: "Matches the allocation workbook",
      status: mismatches ? "fail" : "pass",
      detail: `${baseline.length} workbook line(s) compared, ${mismatches} mismatch(es).`,
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

  // ---- Write + status ------------------------------------------------------
  await db.transaction(async (tx) => {
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
  return { period, status, checks, openExceptions: open.length };
}
