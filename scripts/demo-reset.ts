/**
 * Instant demo reset: restore the live tables from the golden snapshot that
 * `npm run seed` saved inside the same database (src/lib/demo/golden.ts).
 * Run: npm run demo:reset   (uses TURSO_DATABASE_URL, default file:local.db)
 * Only SQL statements go over the wire, never rows.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const { getClient } = await import("../src/db/client");
  const { resolveDbConfig, redactSecrets } = await import("../src/db/env");
  const { restoreGolden } = await import("../src/lib/demo/golden");
  const { isLocalFile } = resolveDbConfig();
  console.log(`Database: ${isLocalFile ? "local file" : "remote Turso"}`);
  try {
    const r = await restoreGolden(getClient());
    for (const [name, n] of Object.entries(r.counts)) console.log(`  ${name.padEnd(20)} ${n}`);
    console.log(`Restored golden snapshot from ${r.createdAt} in ${r.ms} ms.`);
  } catch (err) {
    throw new Error(redactSecrets(err instanceof Error ? err.message : String(err)));
  }
}

main().catch((err) => {
  console.error("Demo reset failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
