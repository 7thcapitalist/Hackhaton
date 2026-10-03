/**
 * Pull runner: for each connector, pull files for the range, then ingest each
 * one with the same ingestFile() the upload route uses.
 *
 * Which path each connector takes:
 *  - mock: true → deterministic mock responses for every connector (no credentials).
 *  - otherwise API connectors run their real API only if their credentials are
 *    set (else "skipped", never silently mocked), and email/manual connectors
 *    read their drop folder (data/inbox/<source_id>/).
 * Runs from a mock pull are flagged ingest_runs.is_synthetic = 1, so screens
 * can label the numbers "simulated".
 */
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { redactSecrets } from "@/db/env";
import { ingestRuns } from "@/db/schema";
import { IngestError, ingestFile, type IngestStatus } from "@/ingest";
import { connectors, getConnector } from "./registry";
import type { Connector, ConnectorMode } from "./types";
import { assertRange } from "./util";

export interface PullAndIngestOptions {
  from: string;
  to: string;
  /** Default: every connector. */
  sourceIds?: string[];
  mock?: boolean;
  db?: Db;
}

export interface PulledFileResult {
  fileName: string;
  status: IngestStatus | "error";
  /** Source the ingest run was recorded under. */
  sourceId?: string;
  ingestRunId?: string;
  ordersInserted: number;
  ordersReplaced: number;
  moneyLinesInserted: number;
  duplicates: number;
  warnings: number;
  error?: string;
  code?: string;
}

export interface ConnectorPullResult {
  sourceId: string;
  mode: ConnectorMode;
  used: "mock" | "real" | "skipped";
  reason?: string;
  files: PulledFileResult[];
  error?: string;
  ms: number;
}

export interface PullSummary {
  from: string;
  to: string;
  mock: boolean;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  totals: {
    files: number;
    ordersInserted: number;
    moneyLinesInserted: number;
    duplicates: number;
    failedFiles: number;
    connectorErrors: number;
  };
  connectors: ConnectorPullResult[];
}

/** Last pull per source in this process (status falls back to the DB). */
export const lastPullBySource = new Map<string, { at: string; used: string; ok: boolean }>();

const message = (err: unknown) => redactSecrets(err instanceof Error ? err.message : String(err));

const emptyFile = (fileName: string): PulledFileResult => ({
  fileName,
  status: "error",
  ordersInserted: 0,
  ordersReplaced: 0,
  moneyLinesInserted: 0,
  duplicates: 0,
  warnings: 0,
});

async function runOne(c: Connector, opts: PullAndIngestOptions, db: Db): Promise<ConnectorPullResult> {
  const t0 = Date.now();
  const apiMode = c.mode === "api_report" || c.mode === "api_json";
  const res: ConnectorPullResult = { sourceId: c.sourceId, mode: c.mode, used: opts.mock ? "mock" : "real", files: [], ms: 0 };
  if (!opts.mock && apiMode && !c.hasCredentials()) {
    res.used = "skipped";
    res.reason = `no credentials (set ${c.requiredEnvVars.join(", ")}) and mock is off`;
    res.ms = Date.now() - t0;
    return res;
  }

  let files;
  try {
    files = await c.pull({ from: opts.from, to: opts.to, mock: !!opts.mock });
  } catch (err) {
    res.error = message(err);
    res.ms = Date.now() - t0;
    return res;
  }
  if (files.length === 0) res.reason = "no files for this range";

  for (const f of files) {
    const out = emptyFile(f.fileName);
    try {
      // JSON goes through auto-detect so the run records the API parser's
      // version; report files are pinned to the connector's source.
      const isJson = /\.json$/i.test(f.fileName);
      const s = await ingestFile({
        buffer: f.bytes,
        fileName: f.fileName,
        sourceId: isJson ? undefined : c.sourceId,
        db,
      });
      Object.assign(out, {
        status: s.status,
        sourceId: s.sourceId,
        ingestRunId: s.ingestRunId,
        ordersInserted: s.ordersInserted,
        ordersReplaced: s.ordersReplaced,
        moneyLinesInserted: s.moneyLinesInserted,
        duplicates: s.duplicates,
        warnings: s.warnings,
        error: s.error,
      });
      if (s.sourceId !== c.sourceId) {
        out.error = `ingested as ${s.sourceId}, expected ${c.sourceId}`;
      }
      if (opts.mock && s.status !== "duplicate") {
        await db.update(ingestRuns).set({ isSynthetic: 1 }).where(eq(ingestRuns.id, s.ingestRunId));
      }
    } catch (err) {
      out.error = message(err);
      if (err instanceof IngestError) out.code = err.code;
    }
    res.files.push(out);
  }
  res.ms = Date.now() - t0;
  return res;
}

export async function pullAndIngest(opts: PullAndIngestOptions): Promise<PullSummary> {
  assertRange(opts);
  const startedAt = new Date().toISOString();
  const db = opts.db ?? getDb();
  let list = connectors;
  if (opts.sourceIds?.length) {
    const unknown = opts.sourceIds.filter((id) => !getConnector(id));
    if (unknown.length) throw new Error(`unknown connector source id(s): ${unknown.join(", ")}`);
    list = connectors.filter((c) => opts.sourceIds!.includes(c.sourceId));
  }

  const results: ConnectorPullResult[] = [];
  for (const c of list) {
    const r = await runOne(c, opts, db);
    results.push(r);
    if (r.used !== "skipped") {
      lastPullBySource.set(c.sourceId, {
        at: new Date().toISOString(),
        used: r.used,
        ok: !r.error && r.files.every((f) => f.status !== "error" && f.status !== "failed"),
      });
    }
  }

  const all = results.flatMap((r) => r.files);
  const totals = {
    files: all.length,
    ordersInserted: all.reduce((a, f) => a + f.ordersInserted, 0),
    moneyLinesInserted: all.reduce((a, f) => a + f.moneyLinesInserted, 0),
    duplicates: all.reduce((a, f) => a + f.duplicates, 0),
    failedFiles: all.filter((f) => f.status === "error" || f.status === "failed").length,
    connectorErrors: results.filter((r) => r.error).length,
  };
  return {
    from: opts.from,
    to: opts.to,
    mock: !!opts.mock,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: totals.failedFiles === 0 && totals.connectorErrors === 0,
    totals,
    connectors: results,
  };
}
