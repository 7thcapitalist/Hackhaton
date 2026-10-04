/**
 * Order lines with traceability (ingest_run_id + source_row) so any pulse or
 * scorecard number can be drilled down to its file and row.
 * Filters: channel, a single business date, or a period. Newest first.
 * Server-only (uses the DB client).
 */
import { and, count, desc, eq, like, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orders } from "@/db/schema";
import type { ChannelId, OrdersView } from "./types";

export interface OrdersQuery {
  channel?: ChannelId;
  date?: string;
  period?: string;
  limit?: number;
  offset?: number;
}

export const ORDERS_DEFAULT_LIMIT = 100;
export const ORDERS_MAX_LIMIT = 1000;

export async function getOrders(q: OrdersQuery = {}): Promise<OrdersView> {
  const db = getDb();
  const filters: SQL[] = [];
  if (q.channel) filters.push(eq(orders.channel, q.channel));
  if (q.date) filters.push(eq(orders.businessDate, q.date));
  if (q.period) filters.push(like(orders.businessDate, `${q.period}-%`));
  const where = filters.length ? and(...filters) : undefined;

  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? ORDERS_DEFAULT_LIMIT)), ORDERS_MAX_LIMIT);
  const offset = Math.max(0, Math.floor(q.offset ?? 0));

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: orders.id,
        channel: orders.channel,
        sourceId: orders.sourceId,
        externalOrderId: orders.externalOrderId,
        buyerKey: orders.buyerKey,
        businessDate: orders.businessDate,
        category: orders.category,
        grossCents: orders.grossCents,
        netCents: orders.netCents,
        status: orders.status,
        ingestRunId: orders.ingestRunId,
        sourceRow: orders.sourceRow,
        supplier: orders.supplier,
        currency: orders.currency,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.orderTs), desc(orders.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(orders).where(where),
  ]);

  return {
    rows: rows.map((r) => ({ ...r, channel: r.channel as ChannelId })),
    total: Number(totalRow[0]?.n ?? 0),
  };
}
