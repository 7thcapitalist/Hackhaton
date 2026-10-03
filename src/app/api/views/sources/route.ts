/** GET /api/views/sources?period=YYYY-MM (default: current month) -> SourceStatusView */
import type { NextRequest } from "next/server";
import { getSourceStatus } from "@/lib/views";
import { currentPeriod, periodParam, respond } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return respond(async () => getSourceStatus(periodParam(req.nextUrl.searchParams, "period", currentPeriod)));
}
