/**
 * GET /api/views/orders?channel=&date=YYYY-MM-DD&period=YYYY-MM&limit=1..1000&offset=0.. -> OrdersView
 * All params optional. Default limit 100.
 */
import type { NextRequest } from "next/server";
import { getOrders, ORDERS_MAX_LIMIT, type ChannelId } from "@/lib/views";
import { badRequest, dateParam, intParam, periodParam, respond } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL_IDS: readonly ChannelId[] = ["shopgoodwill", "amazon", "ebay", "goodwill_books", "other"];

export async function GET(req: NextRequest) {
  return respond(async () => {
    const p = req.nextUrl.searchParams;
    const channel = p.get("channel") || undefined;
    if (channel !== undefined && !CHANNEL_IDS.includes(channel as ChannelId)) {
      badRequest(`Invalid channel "${channel}": expected one of ${CHANNEL_IDS.join(", ")}`);
    }
    return getOrders({
      channel: channel as ChannelId | undefined,
      date: p.get("date") ? dateParam(p, "date") : undefined,
      period: p.get("period") ? periodParam(p, "period") : undefined,
      limit: intParam(p, "limit", 1, ORDERS_MAX_LIMIT),
      offset: intParam(p, "offset", 0, Number.MAX_SAFE_INTEGER),
    });
  });
}
