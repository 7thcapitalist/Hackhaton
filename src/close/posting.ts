/**
 * Business Central import + posting status (slide 40 step 06 "Import/API
 * status", slide 41 WS4 "capture import/API validation and posting response").
 *
 * Today the BC side is SIMULATED: SimulatedBcAdapter accepts the payload,
 * echoes back what a BC import would report (lines accepted, document numbers,
 * totals) and every stored response carries `simulated: true`. Nothing is sent
 * anywhere. BcApiAdapter documents the real calls and is not wired up.
 *
 * markImported(period, { by, batch })
 *   Only for an `exported` close whose posting status is not_posted or failed.
 *   Validates the payload first (each document balances, debits = credits,
 *   BC field lengths, invoice total = its lines = Goodwill Books statement
 *   payment). Validation failure → posting_status `failed` (response kept,
 *   `import_failed` event), returned with ok=false, not thrown.
 *   Success → posting_status `imported`, bc_batch, bc_document_nos.
 * markPosted(period, { by })
 *   Only from `imported`. Adapter posts the batch + invoice and returns the
 *   per-account posted totals → posting_status `posted`, posted_at/by; then
 *   reconcile runs so the "posted vs journal" tie-out is recorded.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { arInvoiceLines, arInvoices, closes, journalLines, moneyLines, type Close } from "@/db/schema";
import { INVOICE_SOURCE } from "./gl-rules";
import {
  BC_DESCRIPTION_MAX,
  CloseError,
  JOURNAL_TEMPLATE,
  appendEvent,
  assertPeriod,
  fmtUsd,
  journalBatch,
  periodCode,
  requireClose,
} from "./common";
import { reconcileClose, type ReconcileResult } from "./reconcile";

export type PostingStatus = "not_posted" | "imported" | "posted" | "failed";

// ---- Payload (what BC receives) ---------------------------------------------

export interface BcJournalLinePayload {
  lineNo: number;
  postingDate: string;
  documentNo: string;
  externalDocumentNo: string | null;
  accountType: string;
  accountNo: string;
  deptCode: string | null;
  description: string | null;
  amountCents: number;
  balAccountType: string | null;
  balAccountNo: string | null;
  sourceId: string | null;
}

export interface BcInvoicePayload {
  customerNo: string | null;
  invoiceDate: string | null;
  postingDate: string | null;
  externalDocumentNo: string | null;
  currency: string;
  lines: { lineNo: number; accountNo: string | null; description: string | null; quantity: number; unitPriceCents: number; amountCents: number; deptCode: string | null }[];
  totalCents: number;
}

export interface PostingPayload {
  period: string;
  journalTemplate: string;
  journalBatch: string;
  lines: BcJournalLinePayload[];
  salesInvoice: BcInvoicePayload | null;
  controlTotals: { journalLines: number; documents: number; debitCents: number; creditCents: number; invoiceLines: number; invoiceTotalCents: number };
}

// ---- Responses (stored in closes.posting_response_json) ----------------------

export interface ValidationCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ImportResponse {
  ok: boolean;
  receivedAt: string;
  journal: {
    template: string;
    batch: string;
    linesAccepted: number;
    linesRejected: number;
    documents: { documentNo: string; lines: number; debitCents: number; creditCents: number }[];
    debitCents: number;
    creditCents: number;
  };
  salesInvoice: { number: string; externalDocumentNo: string | null; linesAccepted: number; totalCents: number } | null;
  errors: string[];
}

export interface PostResponse {
  ok: boolean;
  postedAt: string;
  postedDocumentNos: string[];
  /** Posted net per (source, account), BC sign; Goodwill Books invoice lines as credits. */
  byAccount: { sourceId: string; accountNo: string; cents: number }[];
  debitCents: number;
  creditCents: number;
  invoiceTotalCents: number;
  errors: string[];
}

export interface PostingResponse {
  /** true = no real Business Central call was made. */
  simulated: boolean;
  adapter: string;
  validation: ValidationCheck[];
  import: ImportResponse | null;
  post: PostResponse | null;
}

// ---- Adapters ----------------------------------------------------------------

export interface PostingAdapter {
  readonly name: string;
  readonly simulated: boolean;
  importBatch(payload: PostingPayload): Promise<ImportResponse>;
  post(payload: PostingPayload, imported: ImportResponse): Promise<PostResponse>;
}

/** Accepts every valid payload and echoes back what BC would report. No network. */
export class SimulatedBcAdapter implements PostingAdapter {
  readonly name = "SimulatedBcAdapter";
  readonly simulated = true;

  async importBatch(p: PostingPayload): Promise<ImportResponse> {
    const docs = new Map<string, { documentNo: string; lines: number; debitCents: number; creditCents: number }>();
    for (const l of p.lines) {
      const d = docs.get(l.documentNo) ?? { documentNo: l.documentNo, lines: 0, debitCents: 0, creditCents: 0 };
      d.lines++;
      if (l.amountCents > 0) d.debitCents += l.amountCents;
      else d.creditCents -= l.amountCents;
      docs.set(l.documentNo, d);
    }
    const documents = [...docs.values()];
    return {
      ok: true,
      receivedAt: new Date().toISOString(),
      journal: {
        template: p.journalTemplate,
        batch: p.journalBatch,
        linesAccepted: p.lines.length,
        linesRejected: 0,
        documents,
        debitCents: documents.reduce((s, d) => s + d.debitCents, 0),
        creditCents: documents.reduce((s, d) => s + d.creditCents, 0),
      },
      salesInvoice: p.salesInvoice
        ? {
            number: `SIM-SI-${periodCode(p.period)}-001`,
            externalDocumentNo: p.salesInvoice.externalDocumentNo,
            linesAccepted: p.salesInvoice.lines.length,
            totalCents: p.salesInvoice.totalCents,
          }
        : null,
      errors: [],
    };
  }

  async post(p: PostingPayload, imported: ImportResponse): Promise<PostResponse> {
    const acc = new Map<string, number>();
    const add = (sourceId: string, accountNo: string, cents: number) => {
      const k = `${sourceId}|${accountNo}`;
      acc.set(k, (acc.get(k) ?? 0) + cents);
    };
    for (const l of p.lines) add(l.sourceId ?? "?", l.accountNo, l.amountCents);
    for (const l of p.salesInvoice?.lines ?? []) add(INVOICE_SOURCE, l.accountNo ?? "", -l.amountCents);
    return {
      ok: true,
      postedAt: new Date().toISOString(),
      postedDocumentNos: [
        ...imported.journal.documents.map((d) => d.documentNo),
        ...(imported.salesInvoice ? [`SIM-PSI-${periodCode(p.period)}-001`] : []),
      ],
      byAccount: [...acc.entries()].map(([k, cents]) => {
        const [sourceId, accountNo] = k.split("|");
        return { sourceId, accountNo, cents };
      }),
      debitCents: imported.journal.debitCents,
      creditCents: imported.journal.creditCents,
      invoiceTotalCents: p.salesInvoice?.totalCents ?? 0,
      errors: [],
    };
  }
}

/**
 * TODO (not called): real Business Central API v2.0 adapter.
 *
 * Env (names only, none set today): BC_TENANT_ID, BC_ENVIRONMENT (e.g.
 * "Production"), BC_COMPANY_ID, BC_CLIENT_ID, BC_CLIENT_SECRET (Entra app,
 * client-credentials flow, scope https://api.businesscentral.dynamics.com/.default).
 * Base: https://api.businesscentral.dynamics.com/v2.0/{BC_TENANT_ID}/{BC_ENVIRONMENT}/api/v2.0/companies({BC_COMPANY_ID})
 *
 * importBatch:
 *   GET  /journals?$filter=code eq '{batch}'  (create with POST /journals if missing)
 *   POST /journals({journalId})/journalLines  per line: accountType, accountNumber,
 *        postingDate, documentNumber, externalDocumentNumber, amount, description;
 *        Department via /journalLines({id})/dimensionSetLines (code DEPARTMENT).
 *   POST /salesInvoices (customerNumber, invoiceDate, postingDate, externalDocumentNumber)
 *   POST /salesInvoices({id})/salesInvoiceLines (lineType "Account", lineObjectNumber,
 *        description, quantity, unitPrice)
 *   Response → ImportResponse (lines accepted = 201s; errors = BC error messages).
 * post:
 *   POST /journals({journalId})/Microsoft.NAV.post
 *   POST /salesInvoices({id})/Microsoft.NAV.post
 *   then GET /generalLedgerEntries?$filter=documentNumber eq '…' to build byAccount.
 */
export class BcApiAdapter implements PostingAdapter {
  readonly name = "BcApiAdapter";
  readonly simulated = false;
  async importBatch(): Promise<ImportResponse> {
    throw new CloseError("conflict", "Business Central API adapter is not configured yet (BC_TENANT_ID etc.). Use the simulated adapter.");
  }
  async post(): Promise<PostResponse> {
    throw new CloseError("conflict", "Business Central API adapter is not configured yet (BC_TENANT_ID etc.). Use the simulated adapter.");
  }
}

export const defaultPostingAdapter = (): PostingAdapter => new SimulatedBcAdapter();

// ---- Payload + validation ----------------------------------------------------

export async function buildPostingPayload(db: Db, close: Close, batch = journalBatch(close.period)): Promise<PostingPayload> {
  const lines = await db.select().from(journalLines).where(eq(journalLines.closeId, close.id)).orderBy(journalLines.lineNo);
  const invoices = await db.select().from(arInvoices).where(eq(arInvoices.closeId, close.id));
  const invLines = invoices.length
    ? await db.select().from(arInvoiceLines).where(inArray(arInvoiceLines.invoiceId, invoices.map((i) => i.id))).orderBy(arInvoiceLines.lineNo)
    : [];
  const inv = invoices[0];
  const salesInvoice: BcInvoicePayload | null = inv
    ? {
        customerNo: inv.customerNo,
        invoiceDate: inv.invoiceDate,
        postingDate: inv.postingDate,
        externalDocumentNo: inv.externalDocumentNo,
        currency: inv.currency,
        lines: invLines
          .filter((l) => l.invoiceId === inv.id)
          .map((l) => ({
            lineNo: l.lineNo,
            accountNo: l.accountNo,
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            amountCents: Math.round(l.unitPriceCents * l.quantity),
            deptCode: l.deptCode,
          })),
        totalCents: 0,
      }
    : null;
  if (salesInvoice) salesInvoice.totalCents = salesInvoice.lines.reduce((s, l) => s + l.amountCents, 0);
  const debitCents = lines.reduce((s, l) => s + Math.max(0, l.amountCents), 0);
  const creditCents = lines.reduce((s, l) => s + Math.max(0, -l.amountCents), 0);
  return {
    period: close.period,
    journalTemplate: JOURNAL_TEMPLATE,
    journalBatch: batch,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      postingDate: l.postingDate,
      documentNo: l.documentNo,
      externalDocumentNo: l.externalDocumentNo,
      accountType: l.accountType,
      accountNo: l.accountNo,
      deptCode: l.deptCode,
      description: l.description,
      amountCents: l.amountCents,
      balAccountType: l.balAccountType,
      balAccountNo: l.balAccountNo,
      sourceId: l.sourceId,
    })),
    salesInvoice,
    controlTotals: {
      journalLines: lines.length,
      documents: new Set(lines.map((l) => l.documentNo)).size,
      debitCents,
      creditCents,
      invoiceLines: salesInvoice?.lines.length ?? 0,
      invoiceTotalCents: salesInvoice?.totalCents ?? 0,
    },
  };
}

export async function validatePayload(db: Db, p: PostingPayload): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const docs = new Map<string, number>();
  for (const l of p.lines) if (!l.balAccountNo) docs.set(l.documentNo, (docs.get(l.documentNo) ?? 0) + l.amountCents);
  const unbalanced = [...docs.entries()].filter(([, net]) => net !== 0);
  checks.push({
    key: "documents_balance",
    label: "Every journal document balances",
    ok: unbalanced.length === 0 && p.lines.length > 0,
    detail: p.lines.length === 0 ? "No journal lines." : unbalanced.length ? `Unbalanced: ${unbalanced.map(([d, n]) => `${d} ${fmtUsd(n)}`).join(", ")}` : `${docs.size} document(s) balance.`,
  });
  const selfBalanced = p.lines.filter((l) => l.balAccountNo).length;
  checks.push({
    key: "debits_equal_credits",
    label: "Batch debits = credits",
    ok: selfBalanced > 0 || p.controlTotals.debitCents === p.controlTotals.creditCents,
    detail: `Debits ${fmtUsd(p.controlTotals.debitCents)}, credits ${fmtUsd(p.controlTotals.creditCents)}${selfBalanced ? ` (${selfBalanced} self-balancing line(s))` : ""}.`,
  });
  const tooLong = p.lines.filter((l) => l.documentNo.length > 20 || (l.description ?? "").length > BC_DESCRIPTION_MAX);
  checks.push({
    key: "bc_field_lengths",
    label: "BC field lengths (Document No. ≤ 20, Description ≤ 50, batch ≤ 10)",
    ok: tooLong.length === 0 && p.journalBatch.length <= 10,
    detail: tooLong.length ? `${tooLong.length} line(s) too long.` : `Batch ${p.journalBatch}; all lines fit.`,
  });
  if (p.salesInvoice) {
    const sumLines = p.salesInvoice.lines.reduce((s, l) => s + l.amountCents, 0);
    const stmt = await db
      .select({ amount: moneyLines.amountCents })
      .from(moneyLines)
      .where(and(eq(moneyLines.period, p.period), eq(moneyLines.sourceId, INVOICE_SOURCE), eq(moneyLines.amountType, "statement_payment")));
    const control = stmt.length ? stmt.reduce((s, r) => s + r.amount, 0) : null;
    checks.push({
      key: "invoice_total",
      label: "AR invoice total = its lines = statement payment",
      ok: p.salesInvoice.lines.length > 0 && sumLines === p.salesInvoice.totalCents && (control === null || control === sumLines),
      detail: `Invoice ${fmtUsd(sumLines)} over ${p.salesInvoice.lines.length} line(s); statement ${control === null ? "not found" : fmtUsd(control)}.`,
    });
  }
  return checks;
}

// ---- Actions -----------------------------------------------------------------

export interface PostingResult {
  period: string;
  ok: boolean;
  postingStatus: PostingStatus;
  bcBatch: string | null;
  documentNos: string[];
  simulated: boolean;
  response: PostingResponse;
  /** After posting: the reconcile run that checks posted vs journal. */
  reconcile?: ReconcileResult;
}

export async function markImported(
  period: string,
  opts: { by: string; batch?: string; db?: Db; adapter?: PostingAdapter },
): Promise<PostingResult> {
  assertPeriod(period);
  const who = (opts.by ?? "").trim();
  if (!who) throw new CloseError("bad_input", "mark_imported needs `by` (who imported the batch)");
  const db = opts.db ?? getDb();
  const adapter = opts.adapter ?? defaultPostingAdapter();
  const close = await requireClose(db, period);
  if (close.status !== "exported") {
    throw new CloseError("conflict", `The ${period} close must be approved and exported before it is imported into BC (status: ${close.status}).`);
  }
  if (close.postingStatus === "imported" || close.postingStatus === "posted") {
    throw new CloseError("conflict", `The ${period} close is already ${close.postingStatus} in BC.`);
  }
  const batch = (opts.batch ?? "").trim() || journalBatch(period);
  const payload = await buildPostingPayload(db, close, batch);
  const validation = await validatePayload(db, payload);
  const now = new Date().toISOString();

  if (validation.some((c) => !c.ok)) {
    const response: PostingResponse = { simulated: adapter.simulated, adapter: adapter.name, validation, import: null, post: null };
    await db
      .update(closes)
      .set({ postingStatus: "failed", bcBatch: batch, postingResponseJson: JSON.stringify(response), importedAt: null, importedBy: who })
      .where(eq(closes.id, close.id));
    const failed = validation.filter((c) => !c.ok);
    await appendEvent(db, close.id, { action: "import_failed", actor: who, at: now, detail: failed.map((c) => `${c.label}: ${c.detail}`).join(" | ") });
    return { period, ok: false, postingStatus: "failed", bcBatch: batch, documentNos: [], simulated: adapter.simulated, response };
  }

  const imported = await adapter.importBatch(payload);
  const documentNos = [...imported.journal.documents.map((d) => d.documentNo), ...(imported.salesInvoice ? [imported.salesInvoice.number] : [])];
  const response: PostingResponse = { simulated: adapter.simulated, adapter: adapter.name, validation, import: imported, post: null };
  const status: PostingStatus = imported.ok ? "imported" : "failed";
  await db
    .update(closes)
    .set({
      postingStatus: status,
      bcBatch: batch,
      bcDocumentNos: JSON.stringify(documentNos),
      importedAt: imported.ok ? now : null,
      importedBy: who,
      postingResponseJson: JSON.stringify(response),
    })
    .where(eq(closes.id, close.id));
  await appendEvent(db, close.id, {
    action: imported.ok ? "imported" : "import_failed",
    actor: who,
    at: now,
    detail: `${adapter.simulated ? "SIMULATED " : ""}BC import into ${JOURNAL_TEMPLATE}/${batch}: ${imported.journal.linesAccepted} journal line(s) accepted, ${imported.journal.linesRejected} rejected` +
      (imported.salesInvoice ? `; sales invoice ${imported.salesInvoice.number} ${fmtUsd(imported.salesInvoice.totalCents)}` : "") +
      (imported.errors.length ? `; errors: ${imported.errors.join("; ")}` : ""),
  });
  return { period, ok: imported.ok, postingStatus: status, bcBatch: batch, documentNos, simulated: adapter.simulated, response };
}

export async function markPosted(period: string, opts: { by: string; db?: Db; adapter?: PostingAdapter }): Promise<PostingResult> {
  assertPeriod(period);
  const who = (opts.by ?? "").trim();
  if (!who) throw new CloseError("bad_input", "mark_posted needs `by` (who posted in BC)");
  const db = opts.db ?? getDb();
  const adapter = opts.adapter ?? defaultPostingAdapter();
  const close = await requireClose(db, period);
  if (close.postingStatus !== "imported") {
    throw new CloseError("conflict", `The ${period} close must be imported into BC before it is posted (posting status: ${close.postingStatus}).`);
  }
  const prev = JSON.parse(close.postingResponseJson ?? "null") as PostingResponse | null;
  if (!prev?.import) throw new CloseError("conflict", `No BC import response recorded for ${period}. Mark it imported again.`);
  const payload = await buildPostingPayload(db, close, close.bcBatch ?? journalBatch(period));
  const posted = await adapter.post(payload, prev.import);
  const response: PostingResponse = { ...prev, simulated: adapter.simulated, adapter: adapter.name, post: posted };
  const now = new Date().toISOString();
  const status: PostingStatus = posted.ok ? "posted" : "failed";
  await db
    .update(closes)
    .set({
      postingStatus: status,
      bcDocumentNos: JSON.stringify(posted.postedDocumentNos),
      postedAt: posted.ok ? now : null,
      postedBy: who,
      postingResponseJson: JSON.stringify(response),
    })
    .where(eq(closes.id, close.id));
  await appendEvent(db, close.id, {
    action: posted.ok ? "posted" : "import_failed",
    actor: who,
    at: now,
    detail: `${adapter.simulated ? "SIMULATED " : ""}BC posting of ${close.bcBatch}: ${posted.postedDocumentNos.length} document(s), debits ${fmtUsd(posted.debitCents)}, credits ${fmtUsd(posted.creditCents)}, invoice ${fmtUsd(posted.invoiceTotalCents)}` +
      (posted.errors.length ? `; errors: ${posted.errors.join("; ")}` : ""),
  });
  const reconcile = await reconcileClose(period, { db, by: who });
  return { period, ok: posted.ok, postingStatus: status, bcBatch: close.bcBatch, documentNos: posted.postedDocumentNos, simulated: adapter.simulated, response, reconcile };
}
