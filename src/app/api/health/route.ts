import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { redactSecrets } from "@/db/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().run(sql`select 1`);
    return NextResponse.json({ ok: true, db: "ok" });
  } catch (err) {
    // Drizzle wraps driver errors ("Failed query: ..."); surface the root cause.
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = root instanceof Error ? root.message : String(root);
    return NextResponse.json(
      { ok: false, db: "error", error: redactSecrets(message) },
      { status: 500 },
    );
  }
}
