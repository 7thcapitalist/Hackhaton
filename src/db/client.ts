/**
 * Lazy singleton Drizzle client for Turso (libSQL).
 *
 * - `file:` URLs (local dev, default `file:local.db`) use `@libsql/client`
 *   (Node, native driver). Never use `file:` on Vercel (read-only FS).
 * - `libsql://` / `https://` URLs use `@libsql/client/web` (HTTP, fetch-only),
 *   which is what runs on Vercel.
 *
 * Server-only: never import this from a client component.
 */
import type { Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { resolveDbConfig } from "./env";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };

let client: Client | undefined;
let db: Db | undefined;

function createLibsqlClient(): Client {
  const { url, authToken, isLocalFile } = resolveDbConfig();
  if (isLocalFile) {
    // Loaded lazily so the native driver is only required for local files.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const node = require("@libsql/client") as typeof import("@libsql/client");
    return node.createClient({ url });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const web = require("@libsql/client/web") as typeof import("@libsql/client/web");
  return web.createClient({ url, authToken });
}

export function getClient(): Client {
  if (!client) client = createLibsqlClient();
  return client;
}

export function getDb(): Db {
  if (!db) db = drizzle(getClient(), { schema }) as Db;
  return db;
}

export { schema };
