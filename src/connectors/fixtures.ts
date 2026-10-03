/**
 * Local folders the connectors read:
 *  - data/inbox/<source_id>/    drop folder fed by scheduled emails or humans
 *  - data/fixtures/<source_id>/ mock data generated for the demo (another lane)
 *  - src/sources/__samples__/   parser samples (last-resort mock data)
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readTable } from "@/ingest/read";
import { TIMEZONE } from "@/sources/_shared/table";
import type { ParsedOrder, SourceParser } from "@/sources/types";
import type { PullRange } from "./types";
import { dataDir, filesInRange, listFiles, type LocalFile } from "./util";

export const inboxDir = (sourceId: string) => join(dataDir(), "inbox", sourceId);
export const fixtureDir = (sourceId: string) => join(dataDir(), "fixtures", sourceId);

export function fixtureFiles(sourceId: string, range: PullRange): LocalFile[] {
  return filesInRange(listFiles(fixtureDir(sourceId)), range);
}

/** Parser samples whose file name starts with the source id (top level and other/). */
export function sampleFiles(sourceId: string): LocalFile[] {
  const root = join(process.cwd(), "src", "sources", "__samples__");
  return [...listFiles(root), ...listFiles(join(root, "other"))]
    .filter((f) => f.name.startsWith(`${sourceId}_`))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Orders a file parser reads from fixture files covering `day` (empty when none). */
export async function fixtureOrders(
  sourceId: string,
  parser: SourceParser,
  day: string,
): Promise<ParsedOrder[]> {
  const files = listFiles(fixtureDir(sourceId)).filter((f) => {
    const d = /(\d{4}-\d{2}-\d{2})/.exec(f.name)?.[1];
    const m = /(\d{4}-\d{2})(?!-?\d)/.exec(f.name)?.[1];
    return d === day || (!d && m === day.slice(0, 7));
  });
  const out: ParsedOrder[] = [];
  for (const f of files) {
    try {
      const table = await readTable(readFileSync(f.path), f.name);
      if (!parser.accepts(table, f.name)) continue;
      const res = parser.parse(table, { fileName: f.name, timezone: TIMEZONE });
      out.push(...res.orders.filter((o) => o.businessDate === day));
    } catch {
      // unreadable fixture: fall back to generated data
    }
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
  for (const f of listFiles(fixtureDir(sourceId))) {
    try {
      const table = await readTable(readFileSync(f.path), f.name);
      if (!parser.accepts(table, f.name)) continue;
      const h = table.findIndex((r) => requiredColumns.every((c) => r.map((x) => x.toLowerCase()).includes(c)));
      if (h < 0) continue;
      const header = table[h].map((x) => x.toLowerCase());
      for (const row of table.slice(h + 1)) {
        const rec = Object.fromEntries(header.map((k, i) => [k, row[i] ?? ""]));
        if (dateOf(rec) === day) out.push(rec);
      }
    } catch {
      // ignore
    }
  }
  return out;
}
