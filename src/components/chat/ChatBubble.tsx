"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CHAT_OPEN_EVENT, useHasInlineLauncher } from "./launcher";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { CloseIcon } from "../icons";
import { Markdown } from "./markdown";
import { ChatHttpError, streamChat } from "./stream";
import type { TraceItem, WireMessage } from "./stream";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: TraceItem[];
  /** Friendly error shown instead of (or after) the answer. */
  error?: string;
  stopped?: boolean;
};

const STORAGE_KEY = "mc-chat-v1";
const HISTORY_LIMIT = 20;
const SUGGESTIONS = [
  "Which day of the week do we sell most?",
  "Why were sales lower yesterday?",
  "Which categories give the best margin?",
  "Which source needs attention?",
];

const newId = () => Math.random().toString(36).slice(2, 10);

/** Last N turns for the API. A question that got no answer (error/stop) is dropped with it. */
function buildHistory(msgs: Msg[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of msgs) {
    if (m.role === "assistant" && !m.content.trim()) {
      if (out.length && out[out.length - 1].role === "user") out.pop();
      continue;
    }
    if (m.content.trim()) out.push({ role: m.role, content: m.content });
  }
  const recent = out.slice(-HISTORY_LIMIT);
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}

function friendlyError(err: unknown): string {
  if (err instanceof ChatHttpError) {
    if (err.status === 503) return "Chat isn't configured yet. Once the model key is set for this deployment, answers will appear here.";
    if (err.status === 404) return "The chat service isn't available on this build yet (POST /api/chat returned 404). The rest of the app works as usual.";
    if (err.status === 429) return "Too many questions at once. Wait a moment and try again.";
    return `The chat service returned an error (${err.status}${err.detail ? `: ${err.detail}` : ""}). Try again in a moment.`;
  }
  return "Couldn't reach the chat service. Check your connection and try again.";
}

const icon = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 16 16", "aria-hidden": true };
const ChatIcon = ({ className = "size-5" }: { className?: string }) => (
  <svg {...icon} strokeWidth={1.4} className={className}><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" /><path d="M5.5 6.5h5M5.5 8.5h3" /></svg>
);
const SendIcon = ({ className = "size-3.5" }: { className?: string }) => (
  <svg {...icon} strokeWidth={1.6} className={className}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
);
const StopIcon = ({ className = "size-3" }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={className}><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg>
);
const PlusIcon = ({ className = "size-3.5" }: { className?: string }) => (
  <svg {...icon} strokeWidth={1.6} className={className}><path d="M8 3v10M3 8h10" /></svg>
);

export function ChatBubble() {
  const [open, setOpen] = useState(false);
  const inlineLauncher = useHasInlineLauncher(); // a page header has its own "Ask the data" button
  const returnFocus = useRef<HTMLElement | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleId = useId();

  // Restore the conversation after mount (sessionStorage isn't available during SSR).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { messages?: Msg[]; open?: boolean };
        // An answer cut off by a page navigation comes back marked as stopped.
        if (Array.isArray(saved.messages))
          setMessages(saved.messages.map(m => (m.role === "assistant" && !m.content && !m.error ? { ...m, stopped: true } : m)));
        if (saved.open) setOpen(true);
      }
    } catch {}
    setLoaded(true);
  }, []);

  // Persist once each answer settles, not on every streamed token.
  useEffect(() => {
    if (!loaded || streaming) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, open })); } catch {}
  }, [messages, open, streaming, loaded]);

  // Keep the newest content in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, open]);

  const close = useCallback(() => {
    setOpen(false);
    const back = returnFocus.current;
    returnFocus.current = null;
    requestAnimationFrame(() => (back?.isConnected ? back : bubbleRef.current)?.focus());
  }, []);

  // Opened from an inline launcher (openChat()): remember where to put focus back.
  useEffect(() => {
    const onOpen = () => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener(CHAT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
  }, []);

  // Focus the input on open; Esc closes; Tab stays inside the panel.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // When an answer ends, hand focus back to the (re-enabled) input, unless the user moved elsewhere.
  useEffect(() => {
    if (streaming || !open) return;
    const active = document.activeElement;
    if (!active || active === document.body || panelRef.current?.contains(active)) inputRef.current?.focus();
  }, [streaming, open]);

  // Abort any in-flight answer if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages(prev => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    const userMsg: Msg = { id: newId(), role: "user", content: question };
    const history = buildHistory([...messages, userMsg]);

    setMessages(prev => [...prev, userMsg, { id: newId(), role: "assistant", content: "" }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "";
    setStreaming(true);
    setStatus(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(history, ctrl.signal, ev => {
        switch (ev.type) {
          case "text":
            setStatus(null);
            patchLast(m => ({ ...m, content: m.content + ev.delta }));
            break;
          case "tool":
            setStatus(ev.label || `Running ${ev.name}…`);
            break;
          case "trace":
            patchLast(m => ({ ...m, trace: [...(m.trace ?? []), ...(ev.items ?? [])] }));
            break;
          case "error":
            patchLast(m => ({ ...m, error: ev.message || "Something went wrong while answering." }));
            break;
          case "done":
            break;
        }
      });
    } catch (err) {
      if (ctrl.signal.aborted) patchLast(m => ({ ...m, stopped: true }));
      else patchLast(m => ({ ...m, error: friendlyError(err) }));
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setStatus(null);
    }
  };

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  return (
    <div data-print-hide>
      {!open && !inlineLauncher && (
        <div className="group fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
          <span role="tooltip" id={`${titleId}-tip`}
            className="pointer-events-none absolute right-full top-1/2 mr-2.5 -translate-y-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium whitespace-nowrap text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            Ask the data
          </span>
          <button ref={bubbleRef} type="button" onClick={() => setOpen(true)} aria-label="Ask the data" aria-describedby={`${titleId}-tip`}
            aria-haspopup="dialog" aria-expanded={false}
            className="grid size-12 place-items-center rounded-full bg-accent text-accent-ink shadow-pop transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <ChatIcon />
            {messages.length > 0 && <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-accent bg-accent-ink" aria-hidden />}
          </button>
        </div>
      )}

      {open && (
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(600px,calc(100dvh-48px))] sm:w-[400px] sm:overflow-hidden sm:rounded-lg sm:border sm:border-line sm:shadow-pop">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <ChatIcon className="size-4 shrink-0 text-ink-3" />
              <div className="flex min-w-0 flex-col">
                <h2 id={titleId} className="text-sm font-semibold tracking-[-0.01em]">Ask the data</h2>
                <span className="truncate text-[11.5px] text-ink-3">Queried from the live database</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {messages.length > 0 && (
                <button type="button" onClick={newChat}
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
                  <PlusIcon />New chat
                </button>
              )}
              <button type="button" onClick={close} aria-label="Close chat"
                className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
                <CloseIcon />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite" aria-busy={streaming}>
            {messages.length === 0 ? (
              <EmptyState onPick={q => void send(q)} />
            ) : (
              messages.map((m, i) => (
                <MessageView key={m.id} msg={m} live={streaming && i === messages.length - 1} status={status} />
              ))
            )}
          </div>

          <form className="border-t border-line px-3 pt-3 pb-[max(10px,env(safe-area-inset-bottom))]" onSubmit={e => { e.preventDefault(); void send(input); }}>
            <div className="flex items-end gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-accent-line focus-within:ring-2 focus-within:ring-accent-soft">
              <label htmlFor={`${titleId}-input`} className="sr-only">Your question</label>
              <textarea id={`${titleId}-input`} ref={inputRef} rows={1} value={input} disabled={streaming}
                onChange={e => { setInput(e.target.value); autosize(e.target); }} onKeyDown={onInputKey}
                placeholder={streaming ? "Answering…" : "Ask about sales, sources, KPIs…"}
                className="max-h-[140px] min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13.5px] leading-5 text-ink outline-none placeholder:text-ink-4 disabled:opacity-60" />
              {streaming ? (
                <button type="button" onClick={stop} aria-label="Stop answering"
                  className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent">
                  <StopIcon />
                </button>
              ) : (
                <button type="submit" aria-label="Send question" disabled={!input.trim()}
                  className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
                  <SendIcon />
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-3">Mock data · numbers come from the database, not the model&apos;s memory.</p>
          </form>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3">
      <p className="text-[13.5px] text-pretty text-ink-2">Ask anything about sales, sources, KPIs. Answers come from the live data.</p>
      <div className="flex flex-col items-start gap-2">
        {SUGGESTIONS.map(q => (
          <button key={q} type="button" onClick={() => onPick(q)}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ msg, live, status }: { msg: Msg; live: boolean; status: string | null }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg bg-accent-soft px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-ink">{msg.content}</p>
      </div>
    );
  }
  const waiting = live && !msg.content;
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-[1.55] text-ink-2">
      {msg.content && <Markdown text={msg.content} />}
      {live && (status || waiting) && (
        <p className="flex items-center gap-2 text-[12.5px] text-ink-3" role="status">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
          {status ?? "Thinking…"}
        </p>
      )}
      {msg.stopped && <p className="text-[12px] text-ink-3 italic">Stopped.</p>}
      {msg.error && (
        <p className="rounded-lg border border-line bg-warn-soft px-3 py-2 text-[12.5px] text-warn" role="alert">{msg.error}</p>
      )}
      {!live && msg.trace && msg.trace.length > 0 && <Trace items={msg.trace} />}
    </div>
  );
}

function Trace({ items }: { items: TraceItem[] }) {
  return (
    <details className="group rounded-lg border border-line bg-surface-2 text-[12px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 font-medium text-ink-3 select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3 transition-transform group-open:rotate-90"><path d="m6 3 5 5-5 5" /></svg>
        How I got this
        <span className="font-normal text-ink-4">· {items.length} {items.length === 1 ? "step" : "steps"}</span>
      </summary>
      <ol className="flex flex-col gap-2.5 border-t border-line px-3 py-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-[11.5px] font-medium text-ink">{it.tool}</span>
              {it.rowCount != null && <span className="text-ink-3">{it.rowCount.toLocaleString("en-US")} {it.rowCount === 1 ? "row" : "rows"}</span>}
            </div>
            {it.input != null && !isEmptyInput(it.input) && (
              <span className="font-mono text-[11px] break-all text-ink-3">{typeof it.input === "string" ? it.input : JSON.stringify(it.input)}</span>
            )}
            {it.sql && (
              <pre className="overflow-x-auto rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{it.sql}</pre>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

const isEmptyInput = (v: unknown) => typeof v === "object" && v !== null && Object.keys(v).length === 0;
