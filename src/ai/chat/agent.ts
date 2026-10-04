/**
 * The data chat's agent loop on the OpenAI Responses API: a manual streaming
 * function-calling loop. Emits UI events (ChatEvent) as it goes; shared by
 * POST /api/chat and `npm run chat`. Server-only.
 *
 * Docs this follows (official `openai` npm SDK):
 * - Function calling (tool shape, function_call items, function_call_output,
 *   streaming events): https://developers.openai.com/api/docs/guides/function-calling
 * - Streaming (responses.create({ stream: true }), response.output_text.delta,
 *   response.completed, error): https://developers.openai.com/api/docs/guides/streaming-responses
 * - Reasoning items must be passed back with tool outputs; stateless
 *   (store: false) history via toResponseInputItems; reasoning.effort:
 *   https://developers.openai.com/api/docs/guides/reasoning
 * - Prompt caching (stable prefix first, prompt_cache_key,
 *   usage.input_tokens_details.cached_tokens):
 *   https://developers.openai.com/api/docs/guides/prompt-caching
 * - Model id (GPT-6 Astra is the recommended general model):
 *   https://developers.openai.com/api/docs/models ; prices:
 *   https://developers.openai.com/api/docs/pricing
 */
import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { CHAT_SYSTEM_PROMPT } from "./prompt";
import { latestBusinessDate } from "./sql";
import { CHAT_TOOL_DEFS, parseToolArgs, runTool, toolLabel } from "./tools";

export const DEFAULT_CHAT_MODEL = "gpt-6.1-sol";
export const MAX_TOOL_ITERATIONS = 8;
export const MAX_HISTORY_MESSAGES = 20;
const MAX_OUTPUT_TOKENS = 16_000;

export function chatModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function chatConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TraceItem {
  tool: string;
  input: Record<string, unknown>;
  sql?: string;
  rowCount?: number;
}

/** The SSE contract of POST /api/chat (one JSON object per `data:` line). */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string }
  | { type: "trace"; items: TraceItem[] }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatUsage {
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** USD at list prices for known models (pricing page), null for others. */
  estimatedCostUsd: number | null;
}

/** USD per 1M tokens: input, cached input, output (developers.openai.com/api/docs/pricing). */
const PRICES: Record<string, [number, number, number]> = {
  "gpt-6-astra": [10, 1, 50],
  "gpt-6.1-sol": [2, 0.1, 10],
  "gpt-6-luna": [0.1, 0.01, 0.5],
};

function estimateCost(u: ChatUsage): number | null {
  const p = PRICES[u.model];
  if (!p) return null;
  const uncached = u.inputTokens - u.cachedInputTokens;
  return Number(((uncached * p[0] + u.cachedInputTokens * p[1] + u.outputTokens * p[2]) / 1_000_000).toFixed(4));
}

function friendlyApiError(err: InstanceType<typeof OpenAI.APIError>): string {
  if (err instanceof OpenAI.AuthenticationError) return "Chat is misconfigured (invalid API key).";
  if (err instanceof OpenAI.RateLimitError) return "The AI service is busy or out of quota. Try again in a minute.";
  if (err instanceof OpenAI.BadRequestError) return "The AI service rejected the request.";
  if (err.status !== undefined && err.status >= 500) return "The AI service is temporarily unavailable. Try again.";
  return "The AI service returned an error.";
}

class StreamError extends Error {}

export async function runChat(opts: {
  messages: ChatTurn[];
  emit: (e: ChatEvent) => void;
  signal?: AbortSignal;
  client?: OpenAI;
}): Promise<ChatUsage> {
  const { emit, signal } = opts;
  const client = opts.client ?? new OpenAI();
  const model = chatModel();
  const usage: ChatUsage = {
    model,
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: null,
  };
  const trace: TraceItem[] = [];

  // The system prompt (instructions) and tools stay byte-identical across
  // requests so automatic prompt caching applies; the request-time data date
  // goes into the latest user turn instead.
  const latest = await latestBusinessDate();
  const history = opts.messages.slice(-MAX_HISTORY_MESSAGES);
  const context = latest
    ? `[Context: the latest business date with order data is ${latest}. Interpret "today", "yesterday", "this month" and "last week" relative to it.]`
    : "[Context: the database has no order data yet.]";
  const input: ResponseInputItem[] = history.map((m, i) => ({
    role: m.role,
    content: i === history.length - 1 && m.role === "user" ? `${m.content}\n\n${context}` : m.content,
  }));

  let textSoFar = false;

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (signal?.aborted) return finish(usage);
      let iterationHasText = false;
      const writeText = (delta: string) => {
        if (!iterationHasText) {
          iterationHasText = true;
          if (textSoFar) emit({ type: "text", delta: "\n\n" });
        }
        textSoFar = true;
        emit({ type: "text", delta });
      };

      const stream = await client.responses.create(
        {
          model,
          instructions: CHAT_SYSTEM_PROMPT,
          input,
          tools: CHAT_TOOL_DEFS,
          parallel_tool_calls: true,
          reasoning: { effort: "medium" },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          // Stateless: nothing stored server-side; reasoning items come back
          // with encrypted_content and are replayed via toResponseInputItems.
          store: false,
          prompt_cache_key: "mission-control-chat",
          stream: true,
        },
        { signal },
      );

      let final: Response | undefined;
      for await (const ev of stream) {
        switch (ev.type) {
          case "response.output_text.delta":
            writeText(ev.delta);
            break;
          case "response.refusal.delta":
            writeText(ev.delta);
            break;
          case "response.output_item.done":
            if (ev.item.type === "function_call") {
              emit({ type: "tool", name: ev.item.name, label: toolLabel(ev.item.name, parseToolArgs(ev.item.arguments)) });
            }
            break;
          case "response.completed":
          case "response.incomplete":
          case "response.failed":
            final = ev.response;
            break;
          case "error":
            throw new StreamError(ev.message);
        }
      }
      if (!final) throw new StreamError("stream ended without a final response");

      usage.requests++;
      usage.inputTokens += final.usage?.input_tokens ?? 0;
      usage.cachedInputTokens += final.usage?.input_tokens_details?.cached_tokens ?? 0;
      usage.outputTokens += final.usage?.output_tokens ?? 0;
      usage.reasoningTokens += final.usage?.output_tokens_details?.reasoning_tokens ?? 0;

      if (final.status === "failed") {
        console.error("[chat] response failed", final.error?.code, final.error?.message);
        emit({ type: "error", message: "The AI service could not answer. Try again." });
        break;
      }

      const calls = final.output.filter((o): o is ResponseFunctionToolCall => o.type === "function_call");
      if (calls.length === 0) {
        if (final.status === "incomplete") emit({ type: "error", message: "The answer was cut off (too long)." });
        break;
      }
      if (final.status === "incomplete") {
        // Arguments may be truncated; don't run them.
        emit({ type: "error", message: "The request got too large. Try a narrower question." });
        break;
      }

      // Pass back every output item (reasoning items included), then one
      // function_call_output per call.
      input.push(...toResponseInputItems(final.output));
      const outputs = await Promise.all(calls.map((c) => runTool(c.name, c.arguments)));
      calls.forEach((c, i) => {
        const out = outputs[i]!;
        const parsed = parseToolArgs(c.arguments);
        trace.push({
          tool: c.name,
          input: (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>,
          ...(out.sql !== undefined ? { sql: out.sql } : {}),
          ...(out.rowCount !== undefined ? { rowCount: out.rowCount } : {}),
        });
        input.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(out.result) });
      });

      if (iteration === MAX_TOOL_ITERATIONS - 1) {
        emit({ type: "error", message: `Stopped after ${MAX_TOOL_ITERATIONS} tool rounds. Try a narrower question.` });
      }
    }
  } catch (err) {
    if (signal?.aborted) return finish(usage);
    if (err instanceof OpenAI.APIError) {
      emit({ type: "error", message: friendlyApiError(err) });
    } else {
      console.error("[chat] unexpected error", err instanceof Error ? err.message : err);
      emit({ type: "error", message: "Something went wrong while answering." });
    }
  }

  emit({ type: "trace", items: trace });
  emit({ type: "done" });
  return finish(usage);
}

function finish(u: ChatUsage): ChatUsage {
  u.estimatedCostUsd = estimateCost(u);
  return u;
}
