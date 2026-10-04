/**
 * POST /api/demo/reset  header `x-demo-secret: <DEMO_RESET_SECRET>`
 *
 * Fast path (default): restores the live tables from the golden snapshot that
 * `npm run seed` saved inside the same database (src/lib/demo/golden.ts):
 * one write batch of server-side `DELETE` + `INSERT … SELECT`, no rows over
 * the network. Facts, KPI targets and close tables go back to the seeded
 * state; config (sources, channels, GL rules) is left alone.
 * Returns { ok: true, mode: "golden", counts, createdAt, ms }.
 * 409 if the database has no snapshot yet: run `npm run seed` once against it.
 *
 * `?mode=full` (local dev only, refused on Vercel): the old slow path. Reloads
 * the demo data through the real pipeline (every mock export rendered in
 * memory, ingested into a scratch SQLite file, copied in one transaction),
 * then saves a fresh golden snapshot.
 *
 * 503 if DEMO_RESET_SECRET is not set, 401 if the header is missing or wrong.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { redactSecrets } from "@/db/env";
import { NoGoldenError, restoreGolden, saveGolden } from "@/lib/demo/golden";
import { invalidateViews } from "@/lib/views/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handlePOST(req: Request) {
  const expected = process.env.DEMO_RESET_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Demo reset is disabled: DEMO_RESET_SECRET is not set" }, { status: 503 });
  }
  const given = req.headers.get("x-demo-secret") ?? "";
  if (!sameSecret(given, expected)) {
    return NextResponse.json({ error: "Missing or wrong x-demo-secret header" }, { status: 401 });
  }
  const mode = new URL(req.url).searchParams.get("mode") ?? "golden";
  try {
    if (mode === "full") {
      if (process.env.VERCEL) {
        return NextResponse.json(
          { error: "mode=full is for local dev only. Run `npm run seed` from a laptop against this database instead." },
          { status: 400 },
        );
      }
      // Loaded only on this path so the fast path does not bundle the seed pipeline.
      const { fixturesFromModel } = await import("../../../../../scripts/seed/fixtures");
      const { runSeed } = await import("../../../../../scripts/seed/run");
      const db = getDb();
      const result = await runSeed(db, { fixtures: fixturesFromModel(), mode: "staged" });
      const golden = result.problems.length === 0 ? await saveGolden(db.$client) : null;
      return NextResponse.json({ ok: result.problems.length === 0, ...result, mode: "full", goldenSaved: golden !== null });
    }
    if (mode !== "golden") {
      return NextResponse.json({ error: `Unknown mode "${mode}" (use golden or full)` }, { status: 400 });
    }
    const r = await restoreGolden(getDb().$client);
    return NextResponse.json({ ok: true, mode: "golden", createdAt: r.createdAt, counts: r.counts, ms: r.ms });
  } catch (err) {
    if (err instanceof NoGoldenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = redactSecrets(root instanceof Error ? root.message : String(root));
    console.error("[api/demo/reset]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Writes to the database, so cached view results are dropped afterwards. */
export async function POST(...args: Parameters<typeof handlePOST>) {
  try {
    return await handlePOST(...args);
  } finally {
    invalidateViews();
  }
}
