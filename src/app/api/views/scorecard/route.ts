/** GET /api/views/scorecard?period=YYYY-MM (default: last full month) -> ScorecardView */
import type { NextRequest } from "next/server";
import { getScorecard } from "@/lib/views";
import { lastFullPeriod, periodParam, respond } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return respond(async () => getScorecard(periodParam(req.nextUrl.searchParams, "period", lastFullPeriod)));
}
