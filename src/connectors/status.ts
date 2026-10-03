/**
 * Connector status: per source, how data arrives, whether the real path is
 * configured, and when it was last pulled / ingested.
 *
 * "Last pull" = newest ingest run whose file came from a connector (file
 * names start with "pull_"), so it survives restarts and serverless cold
 * starts. Never returns env var values, only whether they are set.
 */
import { desc, like, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { ingestRuns } from "@/db/schema";
import { lastPullBySource } from "./run";
import { connectors } from "./registry";
import type { ConnectorMode } from "./types";
import { env } from "./util";

export interface ConnectorStatus {
  sourceId: string;
  label: string;
  mode: ConnectorMode;
  describe: string;
  /** Env var names the real path reads, with set / not set. */
  envVars: { name: string; set: boolean }[];
  /** API connectors: credentials set. Email/manual: the drop folder has files. */
  configured: boolean;
  /** What a non-mock pull would do right now. */
  realPull: "api" | "drop_folder" | "skipped_no_credentials";
  lastPull: { at: string; fileName: string; status: string; synthetic: boolean } | null;
  lastIngestAt: string | null;
  /** Last pull by this server process, if any (may be newer than the DB row on failure). */
  lastPullThisProcess: { at: string; used: string; ok: boolean } | null;
}

export async function getConnectorStatus(db: Db = getDb()): Promise<ConnectorStatus[]> {
  const lastAny = await db
    .select({ sourceId: ingestRuns.sourceId, at: sql<string>`max(${ingestRuns.uploadedAt})` })
    .from(ingestRuns)
    .groupBy(ingestRuns.sourceId);
  const pulled = await db
    .select({
      sourceId: ingestRuns.sourceId,
      at: ingestRuns.uploadedAt,
      fileName: ingestRuns.fileName,
      status: ingestRuns.status,
      synthetic: ingestRuns.isSynthetic,
    })
    .from(ingestRuns)
    .where(like(ingestRuns.fileName, "pull_%"))
    .orderBy(desc(ingestRuns.uploadedAt))
    .limit(500);

  return connectors.map((c) => {
    const api = c.mode === "api_report" || c.mode === "api_json";
    const configured = c.hasCredentials();
    const last = pulled.find((p) => p.sourceId === c.sourceId);
    return {
      sourceId: c.sourceId,
      label: c.label,
      mode: c.mode,
      describe: c.describe,
      envVars: c.envVars.map((name) => ({ name, set: env(name) !== undefined })),
      configured,
      realPull: !api ? "drop_folder" : configured ? "api" : "skipped_no_credentials",
      lastPull: last ? { at: last.at, fileName: last.fileName, status: last.status, synthetic: last.synthetic === 1 } : null,
      lastIngestAt: lastAny.find((r) => r.sourceId === c.sourceId)?.at ?? null,
      lastPullThisProcess: lastPullBySource.get(c.sourceId) ?? null,
    };
  });
}
