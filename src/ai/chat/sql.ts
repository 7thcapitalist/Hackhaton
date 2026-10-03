/**
 * Executes guarded, read-only SQL for the chat's `run_sql` tool.
 *
 * Safety layers (see sql-guard.ts for the text checks):
 *  - Prefer a read-only client from CHAT_DATABASE_URL + CHAT_DATABASE_AUTH_TOKEN
 *    (a Turso read-only token); fall back to the main client.
 *  - Guard: one statement, SELECT/WITH only, no write/admin keywords, no golden_*.
 *  - Wrapped as SELECT * FROM (<query>) LIMIT 500.
 *  - 10 s timeout.
 *  - Result truncated for the model (rows, cell length, total size), flagged.
 * Server-only.
 */
import type { Client } from "@libsql/client";
import { getClient } from "@/db/client";
import { redactSecrets } from "@/db/env";
import { guardSql, SQL_ROW_LIMIT } from "./sql-guard";

export const SQL_TIMEOUT_MS = 10_000;
/** Rows returned to the model (the query itself is capped at SQL_ROW_LIMIT). */
export const SQL_ROWS_TO_MODEL = 200;
const MAX_CELL_CHARS = 200;
const MAX_RESULT_CHARS = 24_000;

let chatClient: Client | undefined;

/** Read-only client when CHAT_DATABASE_URL is set, else the main DB client. */
export function getChatSqlClient(env: NodeJS.ProcessEnv = process.env): { client: Client; readOnly: boolean } {
  const url = env.CHAT_DATABASE_URL?.trim();
  if (!url) return { client: getClient(), readOnly: false };
  if (!chatClient) {
    const authToken = env.CHAT_DATABASE_AUTH_TOKEN?.trim() || undefined;
    if (url.startsWith("file:")) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const node = require("@libsql/client") as typeof import("@libsql/client");
      chatClient = node.createClient({ url });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const web = require("@libsql/client/web") as typeof import("@libsql/client/web");
      chatClient = web.createClient({ url, authToken });
    }
  }
  return { client: chatClient, readOnly: true };
}

export interface SqlResult {
  ok: true;
  columns: string[];
  rows: unknown[][];
  /** Rows returned by the DB (max SQL_ROW_LIMIT). */
  rowCount: number;
  truncated: boolean;
  note?: string;
  sql: string;
}

export interface SqlError {
  ok: false;
  error: string;
  sql?: string;
}

function cell(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return "[blob]";
  if (typeof v === "string" && v.length > MAX_CELL_CHARS) return `${v.slice(0, MAX_CELL_CHARS)}…`;
  return v;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Query timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function runReadOnlySql(query: unknown): Promise<SqlResult | SqlError> {
  const g = guardSql(query);
  if (!g.ok) return { ok: false, error: `Rejected by SQL guard: ${g.reason}` };

  const { client } = getChatSqlClient();
  let rs;
  try {
    rs = await withTimeout(client.execute(g.wrapped), SQL_TIMEOUT_MS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactSecrets(msg).slice(0, 500), sql: g.sql };
  }

  const columns = rs.columns.slice();
  const all = rs.rows.map((r) => columns.map((_, i) => cell(r[i])));
  let rows = all.slice(0, SQL_ROWS_TO_MODEL);
  let truncated = all.length > rows.length;
  while (rows.length > 1 && JSON.stringify(rows).length > MAX_RESULT_CHARS) {
    rows = rows.slice(0, Math.floor(rows.length / 2));
    truncated = true;
  }
  const notes: string[] = [];
  if (all.length >= SQL_ROW_LIMIT) notes.push(`Query hit the ${SQL_ROW_LIMIT}-row cap; aggregate in SQL instead.`);
  if (truncated) notes.push(`Showing the first ${rows.length} of ${all.length} rows.`);
  return {
    ok: true,
    columns,
    rows,
    rowCount: all.length,
    truncated,
    ...(notes.length ? { note: notes.join(" ") } : {}),
    sql: g.sql,
  };
}

/** Latest business_date with orders, or null for an empty DB. */
export async function latestBusinessDate(): Promise<string | null> {
  try {
    const rs = await withTimeout(getClient().execute("SELECT MAX(business_date) AS d FROM orders"), SQL_TIMEOUT_MS);
    const d = rs.rows[0]?.[0];
    return typeof d === "string" ? d : null;
  } catch {
    return null;
  }
}
