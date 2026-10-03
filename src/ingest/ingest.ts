/**
 * Ingest service: one uploaded file → cleaned fact rows in the database.
 *
 *   bytes ─sha256─▶ duplicate file?  ─▶ readTable ─▶ pick parser ─▶ parse
 *         ─▶ clean (ids, buyer_key, dedupe_key, net, duplicates) ─▶ ONE batch write
 *
 * Cleaning rules (documented for the pitch / ethics notes):
 * - Same file bytes already ingested (non-failed run) → nothing inserted,
 *   `duplicate_file` exception, status "duplicate". A failed run does not block
 *   re-uploading the same file (e.g. after a parser fix).
 * - dedupe_key = `${channel}:${externalOrderId}:${externalItemId ?? ''}`.
 *   A repeat inside the same file keeps the first row. A repeat of a row already
 *   in the DB keeps the DB row, UNLESS the DB row came from a source with
 *   revenue_authority = 0 (e.g. the eBay or ShopGoodwill report) and the new
 *   file's source has revenue_authority = 1 (Upright, the source of truth for
 *   orders): then the new row replaces the old one, in the same transaction. So
 *   Upright wins no matter which file arrives first. Every
 *   dropped or replaced row gets a `duplicate_order` exception naming both sources.
 * - net_cents is recomputed as gross + shipping − refund − fee when the parser
 *   left it 0 with nonzero gross, and corrected if it visibly includes tax.
 *   Tax is never part of net.
 * - Raw buyer ids are hashed (buyer_key) and never stored.
 * - Parser warnings (+ ingest's own) → ingest_runs.warnings_json and ONE
 *   `parse_warning` exception per file.
 * - A file that cannot be ingested → ONE `parse_failed` exception. If a parser
 *   was chosen, a `failed` ingest run is recorded too; if the file could not be
 *   read or recognized (no source known), only the exception is recorded
 *   (source_id = the requested source, or null) and the IngestError is rethrown.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, type Db } from "@/db/client";
import { redactSecrets } from "@/db/env";
import {
  exceptions,
  ingestRuns,
  items,
  moneyLines,
  orders,
  sources,
  type NewDataException,
  type NewIngestRun,
  type NewItem,
  type NewMoneyLine,
  type NewOrder,
} from "@/db/schema";
import { detectParser, getParser } from "@/sources";
import type { ParseResult, ParseWarning, RawTable, SourceParser } from "@/sources/types";
import { normalizeHeader, TIMEZONE } from "@/sources/_shared/table";
import { CHANNEL_IDS, ensureConfig } from "./config";
import { IngestError } from "./errors";
import { readTable } from "./read";

export interface IngestInput {
  buffer: Uint8Array;
  fileName: string;
  /** Skip auto-detection and use this source's parser. */
  sourceId?: string;
  /** YYYY-MM chosen by the user; overrides the parser's period. */
  period?: string;
  /** ISO timestamp; defaults to now. */
  uploadedAt?: string;
  /** Defaults to the app's DB client. */
  db?: Db;
}

export type IngestStatus = "parsed" | "parsed_with_warnings" | "failed" | "duplicate";

export interface IngestSummary {
  /** The new run, or for "duplicate" the earlier run that has the same file. */
  ingestRunId: string;
  sourceId: string;
  fileName: string;
  status: IngestStatus;
  ordersInserted: number;
  /** Lower-authority rows (e.g. eBay, ShopGoodwill) replaced by this file's rows. */
  ordersReplaced: number;
  moneyLinesInserted: number;
  itemsInserted: number;
  /** Order rows dropped as duplicates (in-file or already in DB). */
  duplicates: number;
  warnings: number;
  period: string | null;
  businessDate: string | null;
  error?: string;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATUSES = new Set(["paid", "refunded", "cancelled"]);
const MAX_STORED_WARNINGS = 1000;
const MAX_DUPLICATE_EXCEPTIONS = 200;
const CHUNK = 200;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

let warnedSalt = false;
function buyerSalt(): string {
  const salt = process.env.BUYER_KEY_SALT?.trim();
  if (salt) return salt;
  if (!warnedSalt) {
    console.warn("[ingest] BUYER_KEY_SALT is not set; using an insecure dev default for buyer_key.");
    warnedSalt = true;
  }
  return "dev-only-buyer-key-salt";
}

/** Salted SHA-256 of the marketplace buyer id, per channel. Raw id never stored. */
export function buyerKeyOf(channel: string, buyerId: string): string {
  return sha256Hex(`${buyerSalt()}:${channel}:${buyerId}`);
}

export function dedupeKeyOf(channel: string, externalOrderId: string, externalItemId?: string | null): string {
  return `${channel}:${externalOrderId}:${externalItemId ?? ""}`;
}

export function headerSignature(header: string[]): string {
  return sha256Hex(header.map(normalizeHeader).join("|"));
}

/** First plausible header row, for "unrecognized file" errors. */
function guessHeader(table: RawTable): string[] {
  const row = table.slice(0, 30).find((r) => r.filter((c) => c !== "").length >= 2);
  return (row ?? table[0] ?? []).filter((c) => c !== "");
}

function rootMessage(err: unknown): string {
  const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  return redactSecrets(root instanceof Error ? root.message : String(root));
}

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Stmt = BatchItem<"sqlite">;

async function runBatch(db: Db, stmts: Stmt[]): Promise<void> {
  if (stmts.length === 0) return;
  // libSQL batch = one atomic transaction (one HTTP round trip on Turso).
  await db.batch(stmts as [Stmt, ...Stmt[]]);
}

export async function ingestFile(input: IngestInput): Promise<IngestSummary> {
  const { buffer, fileName } = input;
  const uploadedAt = input.uploadedAt ?? new Date().toISOString();
  if (input.period && !PERIOD_RE.test(input.period)) {
    throw new IngestError("bad_input", `period must be YYYY-MM, got "${input.period}"`);
  }
  if (!buffer || buffer.byteLength === 0) {
    throw new IngestError("bad_input", `${fileName} is empty`);
  }
  let parser: SourceParser | undefined;
  if (input.sourceId) {
    parser = getParser(input.sourceId);
    if (!parser) throw new IngestError("unknown_source", `No parser registered for source "${input.sourceId}"`);
  }

  const db = input.db ?? getDb();
  await ensureConfig(db);
  const fileSha = sha256Hex(buffer);

  // 1. Same bytes already ingested?
  const [prior] = await db
    .select()
    .from(ingestRuns)
    .where(and(eq(ingestRuns.fileSha256, fileSha), ne(ingestRuns.status, "failed")))
    .limit(1);
  if (prior) {
    await db.insert(exceptions).values({
      id: randomUUID(),
      sourceId: prior.sourceId,
      ingestRunId: prior.id,
      kind: "duplicate_file",
      message: `"${fileName}" was already ingested at ${prior.uploadedAt} as "${prior.fileName}" (run ${prior.id}). Nothing was inserted.`,
    });
    return {
      ingestRunId: prior.id,
      sourceId: prior.sourceId,
      fileName,
      status: "duplicate",
      ordersInserted: 0,
      ordersReplaced: 0,
      moneyLinesInserted: 0,
      itemsInserted: 0,
      duplicates: 0,
      warnings: 0,
      period: prior.period,
      businessDate: prior.businessDate,
    };
  }

  // 2. Read and pick a parser.
  let table: RawTable;
  try {
    table = await readTable(buffer, fileName);
    if (!parser) {
      parser = detectParser(table, fileName);
      if (!parser) {
        const header = guessHeader(table);
        throw new IngestError(
          "unrecognized_file",
          `Unrecognized file "${fileName}": no parser accepts it. Header seen: ${
            header.length ? header.join(", ") : "(none)"
          }`,
          { headerSeen: header },
        );
      }
    }
  } catch (err) {
    if (err instanceof IngestError && FAILED_FILE_CODES.has(err.code)) {
      await recordUnreadable(db, fileName, input.sourceId ?? null, err.message);
    }
    throw err;
  }

  const runId = randomUUID();
  const base: Omit<NewIngestRun, "status"> = {
    id: runId,
    sourceId: parser.sourceId,
    fileName,
    fileSha256: fileSha,
    parserVersion: parser.version,
    uploadedAt,
    period: input.period ?? null,
  };

  // 3. Parse (pure) and clean.
  let result: ParseResult;
  try {
    result = parser.parse(table, { fileName, period: input.period, timezone: TIMEZONE });
  } catch (err) {
    return writeFailedRun(db, base, `Parser ${parser.sourceId}@${parser.version} failed: ${rootMessage(err)}`);
  }

  try {
    return await writeParsed(db, base, parser, result, input);
  } catch (err) {
    if (err instanceof IngestError) throw err;
    return writeFailedRun(db, base, `Write failed: ${rootMessage(err)}`);
  }
}

const FAILED_FILE_CODES = new Set<string>(["unsupported_file", "unreadable_file", "unrecognized_file"]);

/** A file we could not read or recognize: no run (no source), one parse_failed exception. */
async function recordUnreadable(db: Db, fileName: string, sourceId: string | null, error: string): Promise<void> {
  try {
    await db.insert(exceptions).values({
      id: randomUUID(),
      sourceId,
      ingestRunId: null,
      kind: "parse_failed",
      message: `Ingest of "${fileName}" failed: ${error}`,
    });
  } catch (err) {
    // Never hide the user's real error behind a logging failure.
    console.error("[ingest] could not record parse_failed exception:", rootMessage(err));
  }
}

async function writeFailedRun(
  db: Db,
  base: Omit<NewIngestRun, "status">,
  error: string,
): Promise<IngestSummary> {
  await runBatch(db, [
    db.insert(ingestRuns).values({ ...base, status: "failed", warningsJson: JSON.stringify({ error }) }),
    db.insert(exceptions).values({
      id: randomUUID(),
      sourceId: base.sourceId,
      ingestRunId: base.id,
      kind: "parse_failed",
      message: `Ingest of "${base.fileName}" failed: ${error}`,
    }),
  ]);
  return {
    ingestRunId: base.id!,
    sourceId: base.sourceId,
    fileName: base.fileName,
    status: "failed",
    ordersInserted: 0,
    ordersReplaced: 0,
    moneyLinesInserted: 0,
    itemsInserted: 0,
    duplicates: 0,
    warnings: 0,
    period: base.period ?? null,
    businessDate: null,
    error,
  };
}

function toInt(v: unknown, field: string, row: number | undefined, warn: (w: ParseWarning) => void): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    warn({ row, message: `${field} is not a number (${String(v)}); used 0` });
    return 0;
  }
  if (!Number.isInteger(n)) {
    warn({ row, message: `${field} was not integer cents (${n}); rounded` });
    return Math.round(n);
  }
  return n;
}

async function writeParsed(
  db: Db,
  base: Omit<NewIngestRun, "status">,
  parser: SourceParser,
  result: ParseResult,
  input: IngestInput,
): Promise<IngestSummary> {
  const sourceId = parser.sourceId;
  const runId = base.id!;
  const warnings: ParseWarning[] = [...(result.warnings ?? [])];
  const warn = (w: ParseWarning) => warnings.push({ ...w, message: `[ingest] ${w.message}` });
  const exc: NewDataException[] = [];
  const channelSet = new Set<string>(CHANNEL_IDS);

  const sourceRows = await db.select().from(sources);
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));
  const me = sourceById.get(sourceId);
  if (!me) throw new IngestError("unknown_source", `Source "${sourceId}" is not in the sources table`);
  const nameOf = (id: string) => sourceById.get(id)?.name ?? id;

  // --- Orders: validate, compute keys, fix net -----------------------------
  const cleaned: NewOrder[] = [];
  for (const parsed of result.orders ?? []) {
    const { buyerId, ...o } = parsed;
    const row = o.sourceRow;
    const externalOrderId = String(o.externalOrderId ?? "").trim();
    if (!externalOrderId) {
      warn({ row, message: "order without an order id; row skipped" });
      continue;
    }
    if (!o.businessDate || !DATE_RE.test(o.businessDate) || !o.orderTs) {
      warn({ row, message: `order ${externalOrderId} has no valid order_ts/business_date; row skipped` });
      continue;
    }
    const status = ORDER_STATUSES.has(o.status) ? o.status : "paid";
    if (status !== o.status) warn({ row, message: `unknown order status "${o.status}"; treated as paid` });
    let channel = o.channel;
    if (!channelSet.has(channel)) {
      warn({ row, message: `unknown channel "${channel}"; mapped to "other"` });
      channel = "other";
    }
    const grossCents = toInt(o.grossCents, "gross_cents", row, warn);
    const shippingCents = toInt(o.shippingCents, "shipping_cents", row, warn);
    const refundCents = toInt(o.refundCents, "refund_cents", row, warn);
    const feeCents = toInt(o.feeCents, "fee_cents", row, warn);
    const taxCents = toInt(o.taxCents, "tax_cents", row, warn);
    let netCents = toInt(o.netCents, "net_cents", row, warn);
    const expectedNet = grossCents + shippingCents - refundCents - feeCents;
    if (netCents === 0 && grossCents !== 0) {
      netCents = expectedNet;
    } else if (taxCents !== 0 && netCents === expectedNet + taxCents) {
      warn({ row, message: `net for order ${externalOrderId} included tax; tax removed from net` });
      netCents = expectedNet;
    }
    const externalItemId = o.externalItemId ? String(o.externalItemId).trim() || null : null;
    cleaned.push({
      ...o,
      id: randomUUID(),
      sourceId,
      ingestRunId: runId,
      channel,
      status,
      externalOrderId,
      externalItemId,
      dedupeKey: dedupeKeyOf(channel, externalOrderId, externalItemId),
      buyerKey: buyerId != null && String(buyerId).trim() !== "" ? buyerKeyOf(channel, String(buyerId).trim()) : null,
      grossCents,
      shippingCents,
      refundCents,
      feeCents,
      taxCents,
      netCents,
    });
  }

  // --- Duplicates inside the file: keep the first ---------------------------
  let duplicates = 0;
  const pushDup = (message: string) => {
    duplicates++;
    if (duplicates <= MAX_DUPLICATE_EXCEPTIONS) {
      exc.push({ id: randomUUID(), sourceId, ingestRunId: runId, kind: "duplicate_order", message });
    }
  };
  const firstByKey = new Map<string, NewOrder>();
  const unique: NewOrder[] = [];
  for (const o of cleaned) {
    const first = firstByKey.get(o.dedupeKey);
    if (first) {
      pushDup(
        `Order ${o.dedupeKey} appears twice in ${me.name} file "${base.fileName}" (rows ${first.sourceRow} and ${o.sourceRow}); kept row ${first.sourceRow}.`,
      );
      continue;
    }
    firstByKey.set(o.dedupeKey, o);
    unique.push(o);
  }

  // --- Duplicates against the DB: revenue authority decides -----------------
  const existing = new Map<string, { id: string; sourceId: string; ingestRunId: string; sourceRow: number }>();
  for (const keys of chunks(unique.map((o) => o.dedupeKey), 500)) {
    const rows = await db
      .select({
        id: orders.id,
        dedupeKey: orders.dedupeKey,
        sourceId: orders.sourceId,
        ingestRunId: orders.ingestRunId,
        sourceRow: orders.sourceRow,
      })
      .from(orders)
      .where(inArray(orders.dedupeKey, keys));
    for (const r of rows) existing.set(r.dedupeKey, r);
  }
  const toInsert: NewOrder[] = [];
  const replaceIds: string[] = [];
  for (const o of unique) {
    const old = existing.get(o.dedupeKey);
    if (!old) {
      toInsert.push(o);
      continue;
    }
    const oldAuth = sourceById.get(old.sourceId)?.revenueAuthority ?? 0;
    const newAuth = me.revenueAuthority ?? 0;
    if (oldAuth === 0 && newAuth === 1) {
      replaceIds.push(old.id);
      toInsert.push(o);
      exc.push({
        id: randomUUID(),
        sourceId,
        ingestRunId: runId,
        kind: "duplicate_order",
        message: `Order ${o.dedupeKey} reported by both ${nameOf(old.sourceId)} (run ${old.ingestRunId}, row ${old.sourceRow}) and ${me.name} (row ${o.sourceRow}); kept ${me.name} (revenue authority), replaced the ${nameOf(old.sourceId)} row.`,
      });
    } else {
      pushDup(
        `Order ${o.dedupeKey} reported by both ${nameOf(old.sourceId)} (run ${old.ingestRunId}, row ${old.sourceRow}) and ${me.name} (row ${o.sourceRow}); kept ${nameOf(old.sourceId)}, dropped the ${me.name} row.`,
      );
    }
  }
  if (duplicates > MAX_DUPLICATE_EXCEPTIONS) {
    exc.push({
      id: randomUUID(),
      sourceId,
      ingestRunId: runId,
      kind: "duplicate_order",
      message: `${duplicates - MAX_DUPLICATE_EXCEPTIONS} more duplicate orders in "${base.fileName}" not listed individually.`,
    });
  }

  // --- Money lines and items --------------------------------------------------
  const lines: NewMoneyLine[] = [];
  for (const m of result.moneyLines ?? []) {
    const row = m.sourceRow;
    if (!m.lineDate || !DATE_RE.test(m.lineDate) || !m.period || !PERIOD_RE.test(m.period) || !m.amountType) {
      warn({ row, message: "money line without valid line_date/period/amount_type; row skipped" });
      continue;
    }
    let channel = m.channel ?? null;
    if (channel != null && !channelSet.has(channel)) {
      warn({ row, message: `unknown channel "${channel}" on money line; set to null` });
      channel = null;
    }
    lines.push({
      ...m,
      id: randomUUID(),
      sourceId,
      ingestRunId: runId,
      channel,
      amountCents: toInt(m.amountCents, "amount_cents", row, warn),
    });
  }
  const itemRows: NewItem[] = (result.items ?? []).map((it) => ({ ...it, id: randomUUID(), ingestRunId: runId }));

  // --- Run metadata -----------------------------------------------------------
  const nameDate = /(\d{4}-\d{2}-\d{2})/.exec(base.fileName)?.[1];
  const nameMonth = /(\d{4}-\d{2})(?!-\d)/.exec(base.fileName)?.[1];
  const businessDate = result.businessDate ?? (input.period ? undefined : nameDate);
  let period = input.period ?? result.period ?? (businessDate ? undefined : nameMonth);
  if (!period && !businessDate) {
    const months = new Set([...toInsert.map((o) => o.businessDate.slice(0, 7)), ...lines.map((l) => l.period)]);
    if (months.size === 1) period = [...months][0];
  }
  const status = warnings.length > 0 ? "parsed_with_warnings" : "parsed";
  if (warnings.length > 0) {
    const first = warnings[0];
    exc.push({
      id: randomUUID(),
      sourceId,
      ingestRunId: runId,
      kind: "parse_warning",
      message: `${warnings.length} warning${warnings.length === 1 ? "" : "s"} in ${me.name} file "${base.fileName}". First: ${
        first.row != null ? `row ${first.row}: ` : ""
      }${first.message}`,
    });
  }
  const run: NewIngestRun = {
    ...base,
    status,
    period: period ?? null,
    businessDate: businessDate ?? null,
    periodLabel: result.periodLabel ?? null,
    rowCount: toInsert.length + lines.length + itemRows.length,
    headerRowIndex: result.headerRowIndex,
    headerSignature: result.header?.length ? headerSignature(result.header) : null,
    warningsJson: warnings.length ? JSON.stringify(warnings.slice(0, MAX_STORED_WARNINGS)) : null,
  };

  // --- One atomic write ---------------------------------------------------------
  const stmts: Stmt[] = [db.insert(ingestRuns).values(run)];
  for (const ids of chunks(replaceIds, 500)) stmts.push(db.delete(orders).where(inArray(orders.id, ids)));
  for (const c of chunks(itemRows)) stmts.push(db.insert(items).values(c));
  for (const c of chunks(toInsert)) stmts.push(db.insert(orders).values(c));
  for (const c of chunks(lines)) stmts.push(db.insert(moneyLines).values(c));
  for (const c of chunks(exc)) stmts.push(db.insert(exceptions).values(c));
  await runBatch(db, stmts);

  return {
    ingestRunId: runId,
    sourceId,
    fileName: base.fileName,
    status,
    ordersInserted: toInsert.length,
    ordersReplaced: replaceIds.length,
    moneyLinesInserted: lines.length,
    itemsInserted: itemRows.length,
    duplicates,
    warnings: warnings.length,
    period: run.period ?? null,
    businessDate: run.businessDate ?? null,
  };
}
