import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolveDbConfig } from "./src/db/env";

// Local credentials: `vercel env pull .env.local` or copy .env.example.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const { url, authToken } = resolveDbConfig();

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url, authToken },
  // golden_* = demo reset snapshot (src/lib/demo/golden.ts), not in the schema:
  // without this filter `drizzle-kit push` would offer to drop them.
  tablesFilter: ["!golden_*"],
});
