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
});
