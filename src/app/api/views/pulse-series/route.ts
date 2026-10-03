/** GET /api/views/pulse-series?from=YYYY-MM-DD&to=YYYY-MM-DD (max 366 days) -> PulseSeriesView */
import type { NextRequest } from "next/server";
import { getPulseSeries } from "@/lib/views";
import { daysBetween } from "@/lib/views/dates";
import { badRequest, dateParam, respond } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DAYS = 366;

export async function GET(req: NextRequest) {
  return respond(async () => {
    const params = req.nextUrl.searchParams;
    const from = dateParam(params, "from");
    const to = dateParam(params, "to");
    if (from > to) badRequest(`from (${from}) must be on or before to (${to})`);
    if (daysBetween(from, to) + 1 > MAX_DAYS) badRequest(`Range too long: at most ${MAX_DAYS} days`);
    return getPulseSeries(from, to);
  });
}
