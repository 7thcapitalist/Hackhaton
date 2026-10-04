/**
 * Local folders the connectors read:
 *  - data/inbox/<source_id>/    drop folder fed by scheduled emails or humans
 *  - data/fixtures/<source_id>/ mock data generated for the demo (another lane)
 *  - src/sources/__samples__/   parser samples (parser checks only; never pulled)
 *
 * Mock fixture set (useMockFixtures): the seed / demo reset hands the
 * connectors an in-memory set of fixture files (the committed data/fixtures,
 * or the same files rendered by the mock writers on Vercel, where data/ is not
 * deployed). While a set is active, mock pulls read ONLY that set: no inbox,
 * no parser samples, no generated data, so a reset loads exactly the mock
 * truth. Parsed tables are cached per file for the duration of the set.
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readTable } from "@/ingest/read";
import { TIMEZONE } from "@/sources/_shared/table";
import type { ParsedOrder, RawTable, SourceParser } from "@/sources/types";
import type { PullRange } from "./types";
import { dataDir, filesInRange, listFiles, type LocalFile } from "./util";

export const inboxDir = (sourceId: string) => join(dataDir(), "inbox", sourceId);
export const fixtureDir = (sourceId: string) => join(dataDir(), "fixtures", sourceId);

/** One fixture file: path relative to data/fixtures ("<source_id>/<name>"). */
export interface MockFixtureFile {
  path: string;
  bytes: Uint8Array;
}

let memSet: Map<string, LocalFile[]> | null = null;
const tableCache = new Map<string, Promise<RawTable>>();
const ordersCache = new Map<string, ParsedOrder[] | null>();
const rowsCache = new Map<string, Map<string, Record<string, string>[]>>();

/**
 * Make mock pulls read `files` only (pass null to go back to data/fixtures on
 * disk). Returns a function that restores the previous state.
 */
export function useMockFixtures(files: MockFixtureFile[] | null): () => void {
  const prev = memSet;
  memSet = null;
  if (files) {
    memSet = new Map();
    for (const f of files) {
      const slash = f.path.indexOf("/");
      const sourceId = f.path.slice(0, slash);
      const name = f.path.slice(slash + 1);
      if (slash < 0 || name.includes("/")) continue;
      const list = memSet.get(sourceId) ?? [];
      list.push({ path: `mem:${f.path}`, name, mtimeMs: 0, bytes: Buffer.from(f.bytes) });
      memSet.set(sourceId, list);
    }
  }
  tableCache.clear();
  ordersCache.clear();
  rowsCache.clear();
  return () => {
    memSet = prev;
    tableCache.clear();
    ordersCache.clear();
    rowsCache.clear();
  };
}

/**
 * True when mocks must not invent data: they return only what the fixture set
 * holds for the requested days, nothing for other days. This is the default,
 * so a mock pull (e.g. the daily cron with CONNECTORS_MOCK=1) can never write
 * generated rows or parser samples into a curated database. Generated mock
 * data is opt-in for local dev with CONNECTORS_MOCK_GENERATE=1, and never
 * while an in-memory fixture set (seed / demo reset) is active.
 */
export function fixturesOnly(): boolean {
  return memSet !== null || process.env.CONNECTORS_MOCK_GENERATE?.trim() !== "1";
}

/** Every fixture file of a source (in-memory set, else data/fixtures/<source_id>/). */
export function fixtureList(sourceId: string): LocalFile[] {
  return memSet ? (memSet.get(sourceId) ?? []) : listFiles(fixtureDir(sourceId));
}

export function fixtureFiles(sourceId: string, range: PullRange): LocalFile[] {
  return filesInRange(fixtureList(sourceId), range);
}

function tableOf(f: LocalFile): Promise<RawTable> {
  const read = () => readTable(f.bytes ?? readFileSync(f.path), f.name);
  if (!memSet) return read();
  let t = tableCache.get(f.path);
  if (!t) {
    t = read();
    tableCache.set(f.path, t);
  }
  return t;
}

/** Orders a file parser reads from fixture files covering `day` (empty when none). */
export async function fixtureOrders(
  sourceId: string,
  parser: SourceParser,
  day: string,
): Promise<ParsedOrder[]> {
  const files = fixtureList(sourceId).filter((f) => {
    const d = /(\d{4}-\d{2}-\d{2})/.exec(f.name)?.[1];
    const m = /(\d{4}-\d{2})(?!-?\d)/.exec(f.name)?.[1];
    return d === day || (!d && m === day.slice(0, 7));
  });
  const out: ParsedOrder[] = [];
  for (const f of files) {
    const key = `${parser.sourceId}|${f.path}`;
    let orders = memSet ? ordersCache.get(key) : undefined;
    if (orders === undefined) {
      try {
        const table = await tableOf(f);
        orders = parser.accepts(table, f.name) ? parser.parse(table, { fileName: f.name, timezone: TIMEZONE }).orders : null;
      } catch {
        orders = null; // unreadable fixture: fall back to generated data
      }
      if (memSet) ordersCache.set(key, orders);
    }
    if (orders) out.push(...orders.filter((o) => o.businessDate === day));
  }
  return out;
}

/** Header→value rows of fixture tables accepted by `parser`, for rows on `day` (by `dateOf`). */
export async function fixtureRows(
  sourceId: string,
  parser: SourceParser,
  day: string,
  requiredColumns: string[],
  dateOf: (row: Record<string, string>) => string | null,
): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = [];
  for (const f of fixtureList(sourceId)) {
    // With a fixture set, rows are indexed by day once per file (same parser + columns => same dateOf).
    const key = `${parser.sourceId}|${requiredColumns.join(",")}|${f.path}`;
    let byDay = memSet ? rowsCache.get(key) : undefined;
    if (byDay === undefined) {
      byDay = new Map();
      try {
        const table = await tableOf(f);
        if (parser.accepts(table, f.name)) {
          const h = table.findIndex((r) => requiredColumns.every((c) => r.map((x) => x.toLowerCase()).includes(c)));
          if (h >= 0) {
            const header = table[h].map((x) => x.toLowerCase());
            for (const row of table.slice(h + 1)) {
              const rec = Object.fromEntries(header.map((k, i) => [k, row[i] ?? ""]));
              const d = dateOf(rec);
              if (!d) continue;
              const list = byDay.get(d) ?? [];
              list.push(rec);
              byDay.set(d, list);
            }
          }
        }
      } catch {
        // ignore
      }
      if (memSet) rowsCache.set(key, byDay);
    }
    out.push(...(byDay.get(day) ?? []));
  }
  return out;
}
