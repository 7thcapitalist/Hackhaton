/**
 * Tools for the data-analysis chat. The view tools wrap the same functions
 * the dashboard uses (src/lib/views), so the chat's numbers match the UI.
 * `run_sql` is the escape hatch for anything the views don't cover.
 *
 * Each tool: a Zod schema (the model's JSON arguments are parsed with
 * JSON.parse and validated with it before running), a JSON schema generated
 * from it for the API, a human-readable label for the UI, and an executor.
 * Server-only.
 */
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import {
  EXCEPTION_KINDS,
  EXCEPTION_STATUSES,
  getCostBreakdown,
  getCostedMargin,
  getExceptions,
  getOrders,
  getPulse,
  getPulseSeries,
  getScorecard,
  getSourceStatus,
  type ChannelId,
  type ExceptionKind,
  type ExceptionStatus,
} from "@/lib/views";
import { daysBetween } from "@/lib/views/dates";
import { runReadOnlySql } from "./sql";

const CHANNELS = ["shopgoodwill", "amazon", "ebay", "goodwill_books", "other"] as const;
const MAX_SERIES_DAYS = 92;
const MAX_ORDERS = 200;
const MAX_EXCEPTIONS = 100;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Business date YYYY-MM-DD (America/Indiana/Indianapolis)");
const period = z.string().regex(/^\d{4}-\d{2}$/).describe("Period YYYY-MM");

export interface ToolOutput {
  /** JSON-serializable payload returned to the model. */
  result: unknown;
  isError?: boolean;
  /** For the "How I got this" trace. */
  sql?: string;
  rowCount?: number;
}

interface ChatTool<S extends z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  label: (input: z.infer<S>) => string;
  run: (input: z.infer<S>) => Promise<ToolOutput>;
}

function tool<S extends z.ZodObject>(t: ChatTool<S>): ChatTool<S> {
  return t;
}

const fail = (message: string): ToolOutput => ({ result: { error: message }, isError: true });

/**
 * Recursively turns every `xxxCents` number into `xxxUsd` dollars (2 decimals)
 * and `cents` into `usd`, so the model never has to convert cost figures.
 */
export function toDollars(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toDollars);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "number" && (k === "cents" || k.endsWith("Cents"))) {
      out[k === "cents" ? "usd" : `${k.slice(0, -5)}Usd`] = Math.round(x) / 100;
    } else if (typeof x === "number" && k === "rateCentsPerHour") {
      out.rateUsdPerHour = x / 100;
    } else out[k] = toDollars(x);
  }
  return out;
}

export const CHAT_TOOLS = [
  tool({
    name: "get_pulse",
    description:
      "Nightly pulse for one business date: net revenue (cents), customers (= transactions) and orders per channel row (ShopGoodwill, Amazon, eBay, Other e-commerce), totals, channels with no data ('missing'), and whether the day is synthetic. Same numbers as the Pulse page.",
    schema: z.object({ date }),
    label: (i) => `Reading the pulse for ${i.date}`,
    run: async (i) => {
      const v = await getPulse(i.date);
      return { result: v, rowCount: v.rows.length };
    },
  }),
  tool({
    name: "get_pulse_series",
    description: `Pulse per day for an inclusive date range (max ${MAX_SERIES_DAYS} days): per-channel and total net revenue (cents) and customers per date. Use for trends, day-of-week and day-vs-day comparisons.`,
    schema: z.object({ from: date, to: date }),
    label: (i) => `Reading daily sales ${i.from} to ${i.to}`,
    run: async (i) => {
      if (i.from > i.to) return fail("`from` must be on or before `to`");
      if (daysBetween(i.from, i.to) + 1 > MAX_SERIES_DAYS) {
        return fail(`Range too long (max ${MAX_SERIES_DAYS} days); split it or use run_sql`);
      }
      const v = await getPulseSeries(i.from, i.to);
      return { result: v, rowCount: v.dates.length };
    },
  }),
  tool({
    name: "get_scorecard",
    description:
      "Monthly COO scorecard for a period: every KPI (value, previous period, target, status ok|simulated|awaiting_data, note), top categories by revenue and by margin, per-category revenue/margin/units/sell-through/ASP, and marketplace metrics. Same numbers as the Scorecard page.",
    schema: z.object({ period }),
    label: (i) => `Reading the ${i.period} scorecard`,
    run: async (i) => {
      const v = await getScorecard(i.period);
      return { result: v, rowCount: v.kpis.length };
    },
  }),
  tool({
    name: "get_source_status",
    description:
      "Data source health for a period: per source whether its files were received, have warnings, are missing or not yet due, last ingest time, row count, open exceptions and missing dates. Use to explain gaps or low numbers caused by missing data.",
    schema: z.object({ period }),
    label: (i) => `Checking data sources for ${i.period}`,
    run: async (i) => {
      const v = await getSourceStatus(i.period);
      return { result: v, rowCount: v.sources.length };
    },
  }),
  tool({
    name: "get_exceptions",
    description: `Data-quality exceptions (missing sources, parse warnings, duplicates, reconcile mismatches, ...), newest first, max ${MAX_EXCEPTIONS}. Optional filters: status, period, kind. Includes counts by kind.`,
    schema: z.object({
      status: z.enum(EXCEPTION_STATUSES as unknown as [ExceptionStatus, ...ExceptionStatus[]]).optional(),
      period: period.optional(),
      kind: z.enum(EXCEPTION_KINDS as unknown as [ExceptionKind, ...ExceptionKind[]]).optional(),
    }),
    label: (i) =>
      `Checking ${i.status ?? ""} data exceptions${i.period ? ` for ${i.period}` : ""}`.replace(/\s+/g, " "),
    run: async (i) => {
      const v = await getExceptions({ ...i, limit: MAX_EXCEPTIONS });
      return { result: v, rowCount: v.rows.length };
    },
  }),
  tool({
    name: "get_orders",
    description: `Individual order lines (newest first) with channel, business date, category, gross and net cents, status, and the source file row they came from. Filters: channel, a single date, or a period; limit default 50, max ${MAX_ORDERS}. 'total' is the full match count. For aggregates prefer run_sql.`,
    schema: z.object({
      channel: z.enum(CHANNELS).optional(),
      date: date.optional(),
      period: period.optional(),
      limit: z.number().int().min(1).max(MAX_ORDERS).optional(),
    }),
    label: (i) =>
      `Looking up orders${i.channel ? ` on ${i.channel}` : ""}${i.date ? ` for ${i.date}` : i.period ? ` for ${i.period}` : ""}`,
    run: async (i) => {
      const v = await getOrders({
        channel: i.channel as ChannelId | undefined,
        date: i.date,
        period: i.period,
        limit: i.limit ?? 50,
      });
      return { result: v, rowCount: v.rows.length };
    },
  }),
  tool({
    name: "get_costs",
    description:
      "P&L-style cost breakdown for a month, amounts in US DOLLARS (keys ending in Usd): gross sales, shipping charged, refunds, per-order marketplace fees, net revenue; shipping label cost (net of carrier refunds) by carrier; processing labor (SIMULATED hours × assumed rate); other marketplace/shipping-account charges (ads, subscriptions, service fees, adjustments); contribution and contribution % (= the scorecard's Net Margin %); plus excluded items (tax collected, cash movements such as postage top-ups, payouts and bank lines, with the reason). Optional channel: revenue is actual, shipping/labor are allocated. USE THIS for any cost, margin, profit, shipping-cost or labor-cost question.",
    schema: z.object({ period, channel: z.enum(CHANNELS).optional() }),
    label: (i) => `Breaking down costs for ${i.period}${i.channel ? ` on ${i.channel}` : ""}`,
    run: async (i) => {
      const v = await getCostBreakdown({ period: i.period, channel: (i.channel as ChannelId | undefined) ?? null });
      return { result: toDollars(v), rowCount: v.shippingLabels.byCarrier.length + v.otherCharges.lines.length };
    },
  }),
  tool({
    name: "get_costed_margin",
    description:
      "Fully costed contribution margin per category or per channel for a month, amounts in US DOLLARS: net revenue, shipping label cost (linked to the order when the label references it, else allocated by share of paid order lines), labor allocated by share of items listed (SIMULATED), other charges, contribution and contribution %. Sorted by contribution, highest first; totals equal get_costs. Includes the allocation method: state it in the answer. USE THIS for 'best/worst category or channel', 'most profitable', 'margin by category/channel'.",
    schema: z.object({ period, by: z.enum(["category", "channel"]) }),
    label: (i) => `Computing costed margin by ${i.by} for ${i.period}`,
    run: async (i) => {
      const v = await getCostedMargin({ period: i.period, by: i.by });
      return { result: toDollars(v), rowCount: v.groups.length };
    },
  }),
  tool({
    name: "run_sql",
    description:
      "Run ONE read-only SQLite query (SELECT or WITH only) against the database, for questions the view tools don't answer (e.g. weekday patterns, category breakdowns, custom comparisons). Results are capped at 500 rows; aggregate in SQL. Write statements, PRAGMA, ATTACH and golden_* tables are rejected. Use strftime('%w', business_date) for weekday (0 = Sunday).",
    schema: z.object({
      query: z.string().min(1).describe("A single SELECT or WITH statement (SQLite dialect)"),
      purpose: z
        .string()
        .min(1)
        .describe("Short plain-English description shown to the user, e.g. 'Revenue by weekday in September'"),
    }),
    label: (i) => (i.purpose.length > 80 ? `${i.purpose.slice(0, 77)}...` : i.purpose),
    run: async (i) => {
      const r = await runReadOnlySql(i.query);
      if (!r.ok) return { result: { error: r.error }, isError: true, sql: r.sql ?? i.query };
      return { result: r, sql: r.sql, rowCount: r.rowCount };
    },
  }),
];

type AnyChatTool = (typeof CHAT_TOOLS)[number];

const BY_NAME = new Map<string, AnyChatTool>(CHAT_TOOLS.map((t) => [t.name, t]));

function jsonSchema(schema: z.ZodObject): Record<string, unknown> {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/**
 * OpenAI Responses API function tools, in a fixed order (keeps the prompt
 * prefix stable for automatic prompt caching). strict is off because some
 * parameters are optional; every input is validated with Zod in runTool.
 */
export const CHAT_TOOL_DEFS: FunctionTool[] = CHAT_TOOLS.map((t) => ({
  type: "function",
  name: t.name,
  description: t.description,
  parameters: jsonSchema(t.schema),
  strict: false,
}));

/** Parses the model's JSON argument string; undefined when it is not valid JSON. */
export function parseToolArgs(args: string): unknown {
  try {
    return JSON.parse(args || "{}");
  } catch {
    return undefined;
  }
}

export function toolLabel(name: string, input: unknown): string {
  const t = BY_NAME.get(name);
  if (!t) return name;
  const parsed = t.schema.safeParse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parsed.success ? t.label(parsed.data as any) : name.replace(/_/g, " ");
}

/** Parses (JSON.parse) and validates (Zod) the arguments, then runs the tool. Never throws. */
export async function runTool(name: string, args: string): Promise<ToolOutput> {
  const t = BY_NAME.get(name);
  if (!t) return fail(`Unknown tool ${name}`);
  const input = parseToolArgs(args);
  if (input === undefined) return fail(`INVALID_JSON: arguments were not valid JSON: ${args.slice(0, 500)}`);
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `INVALID_INPUT: ${parsed.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ")}`,
    );
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await t.run(parsed.data as any);
  } catch (err) {
    return fail(err instanceof Error ? err.message.slice(0, 500) : String(err));
  }
}
