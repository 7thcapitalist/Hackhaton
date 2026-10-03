/**
 * Where the seed gets its files:
 * - fixturesFromDisk(): the committed data/fixtures/** in manifest order
 *   (npm run seed: "ingest the files on disk").
 * - fixturesFromModel(): the same files rendered in memory by the mock
 *   writers (demo reset on Vercel, where data/ is not deployed). Byte-identical
 *   to the committed files (`npm run mock:generate -- --check`).
 */
import { buildFixtures, type ManifestEntry } from "../mock/fixtures";
import type { SeedFixture } from "./run";

export async function fixturesFromDisk(root?: string): Promise<SeedFixture[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = root ?? join(process.cwd(), "data", "fixtures");
  let manifest: ManifestEntry[];
  try {
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as ManifestEntry[];
  } catch {
    throw new Error(`No ${join(dir, "manifest.json")}. Run \`npm run mock:generate\` first.`);
  }
  return Promise.all(
    manifest.map(async (m) => ({
      path: m.path,
      sourceId: m.sourceId,
      uploadedAt: m.uploadedAt,
      bytes: new Uint8Array(await readFile(join(dir, m.path))),
    })),
  );
}

export function fixturesFromModel(): SeedFixture[] {
  const enc = new TextEncoder();
  return buildFixtures().map((f) => ({ path: f.path, sourceId: f.sourceId, uploadedAt: f.uploadedAt, bytes: enc.encode(f.content) }));
}
