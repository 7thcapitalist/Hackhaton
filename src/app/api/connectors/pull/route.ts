/**
 * Pull data from the connectors and ingest it.
 *
 *   POST /api/connectors/pull   body (JSON, all optional):
 *     { "from": "2026-10-01", "to": "2026-10-03", "mock": true, "sourceIds": ["ebay"] }
 *   GET  /api/connectors/pull?from=…&to=…&mock=1&source=ebay   (Vercel Cron sends GET)
 *
 * Default range: yesterday (America/Indiana/Indianapolis). Default mock:
 * CONNECTORS_MOCK=1 in the env, else false (real APIs where configured).
 * Auth: `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends). If
 * CRON_SECRET is unset, only non-production builds allow the call.
 * Returns the PullSummary from src/connectors/run.ts.
 */
import { NextResponse } from "next/server";
import { redactSecrets } from "@/db/env";
import { pullAndIngest } from "@/connectors";
import { businessDateOf } from "@/sources/_shared/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function yesterday(): string {
  const today = businessDateOf(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const truthy = (v: unknown) => v === true || v === "1" || v === "true";

async function run(input: { from?: string; to?: string; mock?: unknown; sourceIds?: string[] }) {
  const from = input.from ?? input.to ?? yesterday();
  const to = input.to ?? from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ status: "error", code: "bad_input", error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }
  const mock = input.mock === undefined ? truthy(process.env.CONNECTORS_MOCK) : truthy(input.mock);
  try {
    const summary = await pullAndIngest({ from, to, mock, sourceIds: input.sourceIds });
    return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    const badInput = /YYYY-MM-DD|after|longer than|unknown connector/.test(message);
    if (!badInput) console.error("[api/connectors/pull]", message);
    return NextResponse.json(
      { status: "error", code: badInput ? "bad_input" : "internal", error: message },
      { status: badInput ? 400 : 500 },
    );
  }
}

const unauthorized = () => NextResponse.json({ status: "error", code: "unauthorized" }, { status: 401 });

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  let body: Record<string, unknown> = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ status: "error", code: "bad_input", error: "body must be JSON" }, { status: 400 });
    }
  }
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : undefined;
  return run({
    from: typeof body.from === "string" ? body.from : undefined,
    to: typeof body.to === "string" ? body.to : undefined,
    mock: body.mock,
    sourceIds,
  });
}

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const q = new URL(req.url).searchParams;
  const sources = q.getAll("source").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  return run({
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    mock: q.has("mock") ? q.get("mock") || "1" : undefined,
    sourceIds: sources.length ? sources : undefined,
  });
}
