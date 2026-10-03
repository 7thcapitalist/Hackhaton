/**
 * Seed script (stub). T2/T15 will load fixtures from data/fixtures/ here.
 * For now it only connects and prints the row count of every table; it
 * writes nothing.
 *
 * Run: npm run seed
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  // Import after dotenv so the client sees the env vars.
  const { getTableName, is, sql } = await import("drizzle-orm");
  const { SQLiteTable } = await import("drizzle-orm/sqlite-core");
  const { getDb, schema } = await import("../src/db/client");
  const { resolveDbConfig } = await import("../src/db/env");

  const { isLocalFile } = resolveDbConfig();
  console.log(`Database: ${isLocalFile ? "local file" : "remote Turso"}`);

  const db = getDb();
  const tables = (Object.values(schema) as unknown[]).filter(
    (v): v is InstanceType<typeof SQLiteTable> => is(v, SQLiteTable),
  );
  for (const table of tables) {
    const name = getTableName(table);
    try {
      const row = await db.get<{ n: number }>(
        sql`select count(*) as n from ${sql.identifier(name)}`,
      );
      console.log(`${name.padEnd(20)} ${row?.n ?? 0}`);
    } catch {
      console.log(`${name.padEnd(20)} (missing, run npm run db:push)`);
    }
  }
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
