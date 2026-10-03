/**
 * GET /api/views/ingest-runs?sourceId=&period=YYYY-MM&limit=1..500&offset=0..
 * -> IngestRunsView (upload history). All params optional. Default limit 50, newest first.
 */
import type { NextRequest } from "next/server";
import { getIngestRuns, INGEST_RUNS_MAX_LIMIT } from "@/lib/views";
import { intParam, periodParam, respond } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return respond(async () => {
    const p = req.nextUrl.searchParams;
    return getIngestRuns({
      sourceId: p.get("sourceId") || undefined,
      period: p.get("period") ? periodParam(p, "period") : undefined,
      limit: intParam(p, "limit", 1, INGEST_RUNS_MAX_LIMIT),
      offset: intParam(p, "offset", 0, Number.MAX_SAFE_INTEGER),
    });
  });
}
