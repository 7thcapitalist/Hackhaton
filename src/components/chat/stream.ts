/** Wire contract for POST /api/chat (server side is built separately). */
export type ChatRole = "user" | "assistant";
export type WireMessage = { role: ChatRole; content: string };

export type TraceItem = { tool: string; input?: unknown; sql?: string; rowCount?: number };

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label?: string }
  | { type: "trace"; items: TraceItem[] }
  | { type: "error"; message: string }
  | { type: "done" };

/** Thrown for non-2xx responses so the UI can show a friendly message per status. */
export class ChatHttpError extends Error {
  constructor(public status: number, public detail?: string) {
    super(detail || `HTTP ${status}`);
  }
}

/**
 * POSTs the conversation and calls onEvent for every `data: <json>` event of the
 * text/event-stream response. Resolves when the stream ends; rejects with an
 * AbortError if `signal` fires, or ChatHttpError for a non-2xx status.
 */
export async function streamChat(messages: WireMessage[], signal: AbortSignal, onEvent: (e: ChatEvent) => void): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") detail = body.error;
    } catch {}
    throw new ChatHttpError(res.status, detail);
  }
  if (!res.body) throw new ChatHttpError(res.status, "Empty response");

  const reader = res.body.getReader();
  // Some runtimes keep a body readable after abort; cancel it so Stop is instant.
  const onAbort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await pump(reader, onEvent, signal);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

async function pump(reader: ReadableStreamDefaultReader<Uint8Array>, onEvent: (e: ChatEvent) => void, signal: AbortSignal) {
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (chunk: string) => {
    const data = chunk
      .split("\n")
      .filter(l => l.startsWith("data:"))
      .map(l => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as ChatEvent);
    } catch {
      // Ignore a malformed event rather than killing the whole answer.
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done || signal.aborted) return;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      flush(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) flush(buf);
}
