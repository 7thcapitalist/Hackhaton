/**
 * POST /api/demo/reset  header `x-demo-secret: <DEMO_RESET_SECRET>`
 *
 * Wipes uploaded/seeded facts and reloads the demo data through the real
 * pipeline (same code as `npm run seed`): every mock export file is rendered
 * in memory (Vercel has no data/ folder), ingested by ingestFile() into a
 * scratch SQLite file in /tmp, and the result is copied to the database in one
 * transaction ("staged" mode: a few round trips instead of ~4 per file).
 * Close tables are left alone.
 * 503 if DEMO_RESET_SECRET is not set, 401 if the header is missing or wrong.
 * Returns { ok: true, mode, counts, files, exceptionsByKind, ms, … }.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { redactSecrets } from "@/db/env";
import { fixturesFromModel } from "../../../../../scripts/seed/fixtures";
import { runSeed } from "../../../../../scripts/seed/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expected = process.env.DEMO_RESET_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Demo reset is disabled: DEMO_RESET_SECRET is not set" }, { status: 503 });
  }
  const given = req.headers.get("x-demo-secret") ?? "";
  if (!sameSecret(given, expected)) {
    return NextResponse.json({ error: "Missing or wrong x-demo-secret header" }, { status: 401 });
  }
  try {
    const result = await runSeed(getDb(), { fixtures: fixturesFromModel(), mode: "staged" });
    return NextResponse.json({ ok: result.problems.length === 0, ...result });
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = redactSecrets(root instanceof Error ? root.message : String(root));
    console.error("[api/demo/reset]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
