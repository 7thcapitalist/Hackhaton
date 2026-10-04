/**
 * POST /api/views/revalidate — drop every cached view result (src/lib/views/cache.ts).
 * Writes through the app already do this; use it after a script writes to the production
 * database directly. Needs `Authorization: Bearer $CRON_SECRET` in production.
 */
import { NextResponse } from "next/server";
import { invalidateViews } from "@/lib/views/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ status: "error", code: "unauthorized" }, { status: 401 });
  invalidateViews();
  return NextResponse.json({ status: "ok" });
}
