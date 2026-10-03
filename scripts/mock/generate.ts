/**
 * Render the mock truth into each platform's real export files.
 *
 *   npm run mock:generate            # (re)write data/fixtures/** + manifest.json
 *   npm run mock:generate -- --check # exit 1 if the committed files differ
 *
 * Deterministic: same code => byte-identical files. Only files listed in the
 * previous manifest.json are deleted before writing, so hand-made fixtures in
 * data/fixtures survive.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildFixtures, manifestOf, type ManifestEntry } from "./fixtures";

const ROOT = join(__dirname, "..", "..", "data", "fixtures");
const MANIFEST = join(ROOT, "manifest.json");

function main() {
  const check = process.argv.includes("--check");
  const t0 = Date.now();
  const files = buildFixtures();
  const manifest = manifestOf(files);
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";

  if (check) {
    const bad: string[] = [];
    for (const f of files) {
      const p = join(ROOT, f.path);
      if (!existsSync(p) || readFileSync(p, "utf8") !== f.content) bad.push(f.path);
    }
    if (!existsSync(MANIFEST) || readFileSync(MANIFEST, "utf8") !== manifestText) bad.push("manifest.json");
    if (bad.length) {
      console.error(`${bad.length} fixture file(s) differ from the generator (run npm run mock:generate):`);
      for (const b of bad.slice(0, 20)) console.error(`  ${b}`);
      process.exit(1);
    }
    console.log(`All ${files.length} fixture files match the generator.`);
    return;
  }

  if (existsSync(MANIFEST)) {
    const old = JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
    for (const e of old) rmSync(join(ROOT, e.path), { force: true });
  }
  for (const f of files) {
    const p = join(ROOT, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content, "utf8");
  }
  writeFileSync(MANIFEST, manifestText, "utf8");

  const bySource = new Map<string, { n: number; bytes: number }>();
  for (const m of manifest) {
    const s = bySource.get(m.sourceId) ?? { n: 0, bytes: 0 };
    s.n++;
    s.bytes += m.bytes;
    bySource.set(m.sourceId, s);
  }
  let total = 0;
  console.log("source                     files       KB");
  for (const [id, s] of [...bySource].sort()) {
    total += s.bytes;
    console.log(`${id.padEnd(26)} ${String(s.n).padStart(5)} ${(s.bytes / 1024).toFixed(0).padStart(8)}`);
  }
  console.log(`${"total".padEnd(26)} ${String(files.length).padStart(5)} ${(total / 1024).toFixed(0).padStart(8)}`);
  for (const m of manifest) if (m.note) console.log(`  messy: ${m.path}: ${m.note}`);
  console.log(`Wrote data/fixtures in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

main();
