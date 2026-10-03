/** GET /api/views/pulse?date=YYYY-MM-DD (default: yesterday, Indianapolis) -> PulseView */
import type { NextRequest } from "next/server";
import { getPulse } from "@/lib/views";
import { dateParam, respond, yesterdayBusinessDate } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return respond(async () => getPulse(dateParam(req.nextUrl.searchParams, "date", yesterdayBusinessDate)));
}
