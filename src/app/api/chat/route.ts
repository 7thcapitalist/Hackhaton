/**
 * POST /api/chat: "ask anything about the data" (OpenAI Responses API + view
 * tools + guarded read-only SQL; see src/ai/chat).
 *
 * Body: { messages: { role: "user" | "assistant", content: string }[] }
 *   plain-text history, last message is the user's question, max 20 messages.
 * Response: text/event-stream, each event `data: <json>\n\n`, one of
 *   { type: "text", delta }            answer text (markdown)
 *   { type: "tool", name, label }      a tool started
 *   { type: "trace", items }           once before done ("How I got this")
 *   { type: "error", message }
 *   { type: "done" }
 * 503 JSON when OPENAI_API_KEY is missing; 429 JSON when rate-limited.
 */
import type { NextRequest } from "next/server";
import { chatConfigured, MAX_HISTORY_MESSAGES, runChat, type ChatEvent, type ChatTurn } from "@/ai/chat/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_CONTENT_CHARS = 4000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

// Light in-memory rate limit (per server instance), 20 requests/min per IP.
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = recent.length >= RATE_LIMIT;
  if (!limited) recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return limited;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parseMessages(body: unknown): ChatTurn[] | string {
  if (!body || typeof body !== "object" || !Array.isArray((body as { messages?: unknown }).messages)) {
    return "Body must be { messages: { role, content }[] }";
  }
  const raw = (body as { messages: unknown[] }).messages;
  if (raw.length === 0) return "messages must not be empty";
  if (raw.length > MAX_HISTORY_MESSAGES) return `At most ${MAX_HISTORY_MESSAGES} messages`;
  const out: ChatTurn[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") return 'Each message role must be "user" or "assistant"';
    if (typeof content !== "string" || !content.trim()) return "Each message content must be a non-empty string";
    if (content.length > MAX_CONTENT_CHARS) return `Message too long (max ${MAX_CONTENT_CHARS} characters)`;
    out.push({ role, content });
  }
  if (out[out.length - 1]!.role !== "user") return "The last message must be from the user";
  return out;
}

export async function POST(req: NextRequest) {
  if (!chatConfigured()) return json(503, { error: "Chat is not configured (OPENAI_API_KEY missing)" });
  if (rateLimited(clientIp(req))) return json(429, { error: "Too many requests. Try again in a minute." });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON" });
  }
  const messages = parseMessages(body);
  if (typeof messages === "string") return json(400, { error: messages });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await runChat({ messages, emit, signal: req.signal });
      } catch {
        emit({ type: "error", message: "Something went wrong while answering." });
        emit({ type: "done" });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* client went away */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
