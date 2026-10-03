/**
 * getCloseView(period): everything the close page needs, in one call.
 * Works before a close exists (status "collecting": only the sources checklist).
 *
 * Money is integer cents. Journal amounts use BC sign (+ = debit, - = credit).
 */
import { eq, inArray, like, or } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { arInvoiceLines, arInvoices, exceptions, glRules, ingestRuns, journalLines, orders, sources } from "@/db/schema";
import { INVOICE_SOURCE, SOURCE_CODES } from "./gl-rules";
import { assertPeriod, findClose, parseTrace } from "./common";

export type CloseStatus = "collecting" | "generated" | "reconciled" | "approved" | "exported";

export interface CloseSourceFile {
  ingestRunId: string;
  fileName: string;
  uploadedAt: string;
  status: "parsed" | "parsed_with_warnings" | "failed";
  rowCount: number;
  warningCount: number;
}

export interface CloseSourceItem {
  sourceId: string;
  name: string;
  kind: string;
  /** received = at least one good file; warnings = received, but a file has warnings or failed. */
  status: "received" | "missing" | "warnings";
  fileCount: number;
  warningCount: number;
  lastUploadedAt: string | null;
  /** Where its money goes in the close. */
  target: "journal" | "invoice";
  files: CloseSourceFile[];
}

export interface CloseLineView {
  lineNo: number;
  documentNo: string;
  postingDate: string;
  accountType: string;
  accountNo: string;
  deptCode: string | null;
  description: string | null;
  amountCents: number;
  balAccountType: string | null;
  balAccountNo: string | null;
  sourceId: string | null;
  amountType: string | null;
  isPlaceholder: boolean;
  isBalancing: boolean;
  /** Number of fact rows behind the line (0 for balancing lines). */
  factCount: number;
  files: string[];
}

export interface CloseDocumentView {
  documentNo: string;
  sourceId: string | null;
  sourceName: string;
  postingDate: string;
  lines: CloseLineView[];
  debitCents: number;
  creditCents: number;
  /** Σ amount of lines without their own balancing account; 0 = balanced. */
  balanceCents: number;
  balanced: boolean;
}

export interface CloseAccountTotal {
  accountType: string;
  accountNo: string;
  deptCode: string | null;
  debitCents: number;
  creditCents: number;
  netCents: number;
  isPlaceholder: boolean;
}

export interface CloseInvoiceView {
  customerNo: string | null;
  invoiceDate: string | null;
  postingDate: string | null;
  externalDocumentNo: string | null;
  currency: string;
  lines: {
    lineNo: number;
    accountNo: string | null;
    description: string | null;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
    deptCode: string | null;
    factCount: number;
  }[];
  totalCents: number;
}

export interface CloseExceptionView {
  id: string;
  kind: string;
  sourceId: string | null;
  message: string;
  expectedCents: number | null;
  actualCents: number | null;
  owner: string | null;
  status: "open" | "resolved" | "waived";
  createdAt: string;
  resolvedAt: string | null;
}

export interface CloseView {
  period: string;
  status: CloseStatus;
  closeId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  sources: CloseSourceItem[];
  documents: CloseDocumentView[];
  totalsByAccount: CloseAccountTotal[];
  invoice: CloseInvoiceView | null;
  exceptions: CloseExceptionView[];
  summary: {
    journalLines: number;
    documents: number;
    balancedDocuments: number;
    debitCents: number;
    creditCents: number;
    placeholderLines: number;
    openExceptions: number;
    /** Marketplace-facilitator tax in the period, not journaled. */
    excludedTaxCents: number;
    sourcesReceived: number;
    sourcesExpected: number;
  };
  /** Which actions make sense now. */
  can: { generate: boolean; approve: boolean; forceApprove: boolean; export: boolean };
}

export async function getCloseView(period: string, opts: { db?: Db } = {}): Promise<CloseView> {
  assertPeriod(period);
  const db = opts.db ?? getDb();
  const close = await findClose(db, period);

  // ---- Sources checklist ----------------------------------------------------
  const [sourceRows, runs] = await Promise.all([
    db.select().from(sources).where(eq(sources.active, 1)),
    db
      .select()
      .from(ingestRuns)
      .where(or(eq(ingestRuns.period, period), like(ingestRuns.businessDate, `${period}-%`))),
  ]);
  const order = Object.keys(SOURCE_CODES);
  const sourceList: CloseSourceItem[] = sourceRows
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((s) => {
      const files: CloseSourceFile[] = runs
        .filter((r) => r.sourceId === s.id)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
        .map((r) => ({
          ingestRunId: r.id,
          fileName: r.fileName,
          uploadedAt: r.uploadedAt,
          status: r.status,
          rowCount: r.rowCount,
          warningCount: countWarnings(r.warningsJson) + (r.status === "failed" ? 1 : 0),
        }));
      const good = files.some((f) => f.status !== "failed");
      const warningCount = files.reduce((n, f) => n + f.warningCount, 0);
      return {
        sourceId: s.id,
        name: s.name,
        kind: s.kind,
        status: !good ? "missing" : warningCount ? "warnings" : "received",
        fileCount: files.length,
        warningCount,
        lastUploadedAt: files[0]?.uploadedAt ?? null,
        target: s.id === INVOICE_SOURCE ? "invoice" : "journal",
        files,
      };
    });

  const taxRows = await db
    .select({ tax: orders.taxCents, status: orders.status })
    .from(orders)
    .where(like(orders.businessDate, `${period}-%`));
  const excludedTaxCents = taxRows.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.tax, 0);

  const sourcesReceived = sourceList.filter((s) => s.status !== "missing").length;
  const empty: CloseView = {
    period,
    status: (close?.status ?? "collecting") as CloseStatus,
    closeId: close?.id ?? null,
    approvedBy: close?.approvedBy ?? null,
    approvedAt: close?.approvedAt ?? null,
    sources: sourceList,
    documents: [],
    totalsByAccount: [],
    invoice: null,
    exceptions: [],
    summary: {
      journalLines: 0,
      documents: 0,
      balancedDocuments: 0,
      debitCents: 0,
      creditCents: 0,
      placeholderLines: 0,
      openExceptions: 0,
      excludedTaxCents,
      sourcesReceived,
      sourcesExpected: sourceList.length,
    },
    can: { generate: true, approve: false, forceApprove: false, export: false },
  };
  if (!close) return empty;

  // ---- Journal --------------------------------------------------------------
  const [lines, rules, invoices, excRows] = await Promise.all([
    db.select().from(journalLines).where(eq(journalLines.closeId, close.id)).orderBy(journalLines.lineNo),
    db.select().from(glRules),
    db.select().from(arInvoices).where(eq(arInvoices.closeId, close.id)),
    db.select().from(exceptions).where(eq(exceptions.closeId, close.id)).orderBy(exceptions.createdAt),
  ]);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const sourceName = new Map(sourceRows.map((s) => [s.id, s.name]));

  const lineViews: CloseLineView[] = lines.map((l) => {
    const rule = l.glRuleId ? ruleById.get(l.glRuleId) : undefined;
    const t = parseTrace(l.traceJson);
    return {
      lineNo: l.lineNo,
      documentNo: l.documentNo,
      postingDate: l.postingDate,
      accountType: l.accountType,
      accountNo: l.accountNo,
      deptCode: l.deptCode,
      description: l.description,
      amountCents: l.amountCents,
      balAccountType: l.balAccountType,
      balAccountNo: l.balAccountNo,
      sourceId: l.sourceId,
      amountType: rule?.amountType ?? null,
      isPlaceholder: !!rule?.isPlaceholder || l.accountNo.startsWith("TBC"),
      isBalancing: t?.kind === "balancing",
      factCount: t?.kind === "facts" ? t.count : 0,
      files: t?.kind === "facts" ? [...new Set(t.runs.map((r) => r.fileName))] : [],
    };
  });

  const docMap = new Map<string, CloseLineView[]>();
  for (const l of lineViews) docMap.set(l.documentNo, [...(docMap.get(l.documentNo) ?? []), l]);
  const documents: CloseDocumentView[] = [...docMap.entries()].map(([documentNo, ls]) => {
    const balanceCents = ls.filter((l) => !l.balAccountNo).reduce((s, l) => s + l.amountCents, 0);
    return {
      documentNo,
      sourceId: ls[0].sourceId,
      sourceName: sourceName.get(ls[0].sourceId ?? "") ?? ls[0].sourceId ?? "",
      postingDate: ls[0].postingDate,
      lines: ls,
      debitCents: ls.reduce((s, l) => s + Math.max(0, l.amountCents), 0),
      creditCents: ls.reduce((s, l) => s + Math.max(0, -l.amountCents), 0),
      balanceCents,
      balanced: balanceCents === 0,
    };
  });

  const totals = new Map<string, CloseAccountTotal>();
  for (const l of lineViews) {
    const k = `${l.accountType}|${l.accountNo}|${l.deptCode ?? ""}`;
    const t = totals.get(k) ?? {
      accountType: l.accountType,
      accountNo: l.accountNo,
      deptCode: l.deptCode,
      debitCents: 0,
      creditCents: 0,
      netCents: 0,
      isPlaceholder: l.isPlaceholder,
    };
    if (l.amountCents > 0) t.debitCents += l.amountCents;
    else t.creditCents -= l.amountCents;
    t.netCents += l.amountCents;
    t.isPlaceholder ||= l.isPlaceholder;
    totals.set(k, t);
  }
  const totalsByAccount = [...totals.values()].sort((a, b) => a.accountNo.localeCompare(b.accountNo));

  // ---- Invoice --------------------------------------------------------------
  let invoice: CloseInvoiceView | null = null;
  if (invoices.length) {
    const inv = invoices[0];
    const invLines = await db
      .select()
      .from(arInvoiceLines)
      .where(inArray(arInvoiceLines.invoiceId, [inv.id]))
      .orderBy(arInvoiceLines.lineNo);
    const ls = invLines.map((l) => {
      const t = parseTrace(l.traceJson);
      return {
        lineNo: l.lineNo,
        accountNo: l.accountNo,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        amountCents: Math.round(l.unitPriceCents * l.quantity),
        deptCode: l.deptCode,
        factCount: t?.kind === "facts" ? t.count : 0,
      };
    });
    invoice = {
      customerNo: inv.customerNo,
      invoiceDate: inv.invoiceDate,
      postingDate: inv.postingDate,
      externalDocumentNo: inv.externalDocumentNo,
      currency: inv.currency,
      lines: ls,
      totalCents: ls.reduce((s, l) => s + l.amountCents, 0),
    };
  }

  const excViews: CloseExceptionView[] = excRows.map((e) => ({
    id: e.id,
    kind: e.kind,
    sourceId: e.sourceId,
    message: e.message,
    expectedCents: e.expectedCents,
    actualCents: e.actualCents,
    owner: e.owner,
    status: e.status,
    createdAt: e.createdAt,
    resolvedAt: e.resolvedAt,
  }));
  const openExceptions = excViews.filter((e) => e.status === "open").length;
  const status = close.status as CloseStatus;

  return {
    ...empty,
    documents,
    totalsByAccount,
    invoice,
    exceptions: excViews,
    summary: {
      ...empty.summary,
      journalLines: lineViews.length,
      documents: documents.length,
      balancedDocuments: documents.filter((d) => d.balanced).length,
      debitCents: documents.reduce((s, d) => s + d.debitCents, 0),
      creditCents: documents.reduce((s, d) => s + d.creditCents, 0),
      placeholderLines: lineViews.filter((l) => l.isPlaceholder).length,
      openExceptions,
    },
    can: {
      generate: status !== "exported",
      approve: status === "reconciled",
      forceApprove: status === "generated",
      export: status === "approved" || status === "exported",
    },
  };
}

function countWarnings(json: string | null): number {
  if (!json) return 0;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

