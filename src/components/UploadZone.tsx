"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { UploadIcon } from "./icons";

type UploadZoneProps = { onFiles: (files: File[]) => void; accept?: string };
export type UploadZoneHandle = { browse: () => void };

export const UploadZone = forwardRef<UploadZoneHandle, UploadZoneProps>(function UploadZone({ onFiles, accept = ".csv,.xlsx" }, ref) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ browse: () => input.current?.click() }));
  const take = (list: FileList | null) => {
    if (list?.length) onFiles(Array.from(list));
  };
  return (
    <div
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      className={`flex flex-col items-center gap-2.5 rounded-xl border-[1.5px] border-dashed px-5.5 py-7.5 text-center transition-colors ${over ? "border-accent bg-accent-soft" : "border-ink-4 bg-surface"}`}
    >
      <span className="grid size-10 place-items-center rounded-[10px] border border-line bg-surface text-accent"><UploadIcon /></span>
      <p className="text-[14.5px] font-semibold text-balance">Drop a marketplace export (CSV or XLSX)</p>
      <p className="text-[12.5px] text-pretty text-ink-3">We detect the source from its column headers and check it before anything is counted.</p>
      <button type="button" onClick={() => input.current?.click()} className="rounded text-[12.5px] font-medium text-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">or browse files</button>
      <input ref={input} type="file" accept={accept} multiple hidden onChange={e => { take(e.target.files); e.target.value = ""; }} />
    </div>
  );
});
