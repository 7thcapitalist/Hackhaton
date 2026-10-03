import type { ReactNode } from "react";

/**
 * Tiny markdown renderer for model answers. It only builds React elements from
 * plain strings, so everything is escaped by React; no HTML from the model is
 * ever injected. Supports: **bold**, *italic*, `code`, bullet and numbered
 * lists, simple pipe tables, ``` fences, and #-headings (shown as bold lines).
 * It is safe to call on a half-streamed string.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="flex flex-col gap-2">{renderBlocks(text)}</div>;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; rows: string[][]; header: boolean }
  | { kind: "code"; text: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|?\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming block)
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { blocks.push({ kind: "h", text: h[1] }); i++; continue; }

    if (TABLE_ROW.test(line) && line.includes("|", line.indexOf("|") + 1)) {
      const raw: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) raw.push(lines[i++]);
      const header = raw.length > 1 && TABLE_SEP.test(raw[1]);
      const rows = raw.filter((_, idx) => !(header && idx === 1)).map(splitRow);
      blocks.push({ kind: "table", rows, header });
      continue;
    }

    const listKind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : null;
    if (listKind) {
      const re = listKind === "ul" ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) { items.push(m[1]); i++; continue; }
        // indented continuation line belongs to the previous item
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; continue; }
        break;
      }
      blocks.push({ kind: listKind, items });
      continue;
    }

    // Always consume the current line so a half-streamed "| col" can't stall the loop.
    const para: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !TABLE_ROW.test(lines[i]) && !lines[i].trim().startsWith("```") && !/^\s*#{1,6}\s/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push({ kind: "p", lines: para });
  }
  return blocks;
}

function renderBlocks(src: string): ReactNode[] {
  return parseBlocks(src).map((b, k) => {
    switch (b.kind) {
      case "h":
        return <p key={k} className="font-semibold text-ink">{inline(b.text)}</p>;
      case "p":
        return <p key={k} className="text-pretty">{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      case "ul":
        return <ul key={k} className="flex list-disc flex-col gap-1 pl-4.5 marker:text-ink-4">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
      case "ol":
        return <ol key={k} className="flex list-decimal flex-col gap-1 pl-5 marker:text-ink-3">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
      case "code":
        return <pre key={k} className="overflow-x-auto rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-2">{b.text}</pre>;
      case "table": {
        const head = b.header ? b.rows[0] : null;
        const body = b.header ? b.rows.slice(1) : b.rows;
        const numeric = (s: string) => /^[-+$€(]?[\d,.]+%?\)?$/.test(s.replace(/\*\*/g, ""));
        return (
          <div key={k} className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-[12.5px]">
              {head && (
                <thead className="bg-surface-2 text-[11px] font-medium tracking-[0.03em] text-ink-3 uppercase">
                  <tr>{head.map((c, j) => {
                    const right = body.length > 0 && body.every(r => !r[j] || numeric(r[j]));
                    return <th key={j} scope="col" className={`px-2.5 py-1.5 font-medium whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{inline(c)}</th>;
                  })}</tr>
                </thead>
              )}
              <tbody>
                {body.map((row, r) => (
                  <tr key={r} className="border-t border-line-2 first:border-t-0">
                    {row.map((c, j) => <td key={j} className={numeric(c) ? "px-2.5 py-1.5 text-right whitespace-nowrap" : "px-2.5 py-1.5"}>{inline(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }
  });
}

// `code` first so stars inside code are left alone; then **bold**, then *italic* / _italic_.
// A new RegExp per call: the bold branch recurses, and a shared /g regex would have
// its lastIndex reset by the inner call (infinite loop).
const INLINE_SRC = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)|(\b_[^_\n]+?_\b)/.source;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_SRC, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = out.length;
    if (m[1]) out.push(<code key={key} className="rounded border border-line bg-surface-2 px-1 font-mono text-[12px] text-ink">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key} className="font-semibold text-ink">{inline(tok.slice(2, -2))}</strong>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
