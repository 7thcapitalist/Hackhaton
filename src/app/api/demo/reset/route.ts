/**
 * POST /api/demo/reset  header `x-demo-secret: <DEMO_RESET_SECRET>`
 *
 * Wipes uploaded/seeded facts and reloads the deterministic synthetic seed
 * (same code as `npm run seed`). Close tables are left alone.
 * 503 if DEMO_RESET_SECRET is not set, 401 if the header is missing or wrong.
 * Returns { ok: true, counts, ms }.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { redactSecrets } from "@/db/env";
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
    const result = await runSeed(getDb());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = redactSecrets(root instanceof Error ? root.message : String(root));
    console.error("[api/demo/reset]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
