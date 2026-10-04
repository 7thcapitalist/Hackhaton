"use client";
import { useEffect, useRef, useState } from "react";
import { formatInt } from "@/app/_lib/format";
import { CheckIcon, UploadIcon } from "../icons";
import { postClose, useAction } from "./api";
import type { Workbook } from "./types";

/**
 * Slide 42 "reproduce + validate": load last month's E-Commerce Allocation workbook
 * so every journal total is compared with it (POST action import_workbook, multipart).
 */
export function WorkbookUpload({ period, workbook, disabled }: { period: string; workbook: Workbook | null | undefined; disabled?: boolean }) {
  const { busy, error, run } = useAction();
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = async (file: File) => {
    const body = new FormData();
    body.append("action", "import_workbook");
    body.append("file", file);
    if (await run("upload", () => postClose(period, body))) setDone(file.name);
  };

  return (
    <div data-print-hide className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border-[1.5px] border-dashed border-ink-4 bg-surface px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-accent"><UploadIcon className="size-4" /></span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[13px] font-semibold">Load last month&apos;s allocation workbook</p>
        <p className="text-xs text-pretty text-ink-3">
          {workbook?.loaded
            ? `${workbook.fileName ? `${workbook.fileName} · ` : ""}${formatInt(workbook.rows)} lines loaded. Upload again to replace it.`
            : "XLSX. We compare every source and account with the workbook before manual posting is retired."}
        </p>
        {done && !error && <p className="flex items-center gap-1.5 text-xs text-ok" aria-live="polite"><CheckIcon className="size-3" />{done} loaded</p>}
        {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      </div>
      <button type="button" disabled={!!busy || disabled} onClick={() => input.current?.click()}
        className="flex h-8 items-center justify-center gap-[7px] rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45">
        {busy ? "Loading…" : workbook?.loaded ? "Replace workbook" : "Choose workbook"}
      </button>
      <input ref={input} type="file" accept=".xlsx,.xlsm,.xls" hidden aria-label="Allocation workbook file"
        onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ""; }} />
    </div>
  );
}

/** Opens every collapsed journal block while printing, so the PDF has all the lines. */
export function PrintExpander() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>("details[data-print-open]:not([open])")];
      opened.forEach(d => (d.open = true));
    };
    const after = () => opened.forEach(d => (d.open = false));
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  return null;
}
