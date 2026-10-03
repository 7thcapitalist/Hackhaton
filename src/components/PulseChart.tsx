"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PulseSeries } from "@/app/_lib/types";
import { formatDay, formatInt, formatMoney } from "@/app/_lib/format";

type PulseChartProps = {
  data: PulseSeries; // channels in stack order, largest first → bottom
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

export const SERIES_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--ink4)"];
const H = 250, L = 52, TOP = 10, BASE = H - 26;

function nice(max: number) {
  const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) ?? 10) * mag;
  return { step, top: step * Math.ceil(max / step) || step };
}

export function PulseChart({ data, selectedDate, onSelectDate }: PulseChartProps) {
  const [metric, setMetric] = useState<"revenue" | "customers">("revenue");
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(1096);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data.dates.length;
  const key = metric === "revenue" ? "revenueCents" : "customers";
  const R = W - 8, pw = R - L, ph = BASE - TOP;

  // Stack: missing values add nothing (they are flagged, never drawn as zero-height data).
  let run = Array<number>(n).fill(0);
  const layers = data.series.map((s, si) => {
    const lo = run.slice();
    run = run.map((v, i) => v + (s[key][i] ?? 0));
    return { s, si, lo, hi: run.slice() };
  });
  const { step, top } = nice(Math.max(...run, 1));
  const X = (i: number) => L + (pw * i) / Math.max(n - 1, 1);
  const Y = (v: number) => TOP + ph * (1 - v / top);
  const pt = (i: number, v: number) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
  const fmtAxis = (v: number) => (key === "revenueCents" ? (v === 0 ? "$0" : `$${(v / 100000).toFixed(v % 100000 ? 1 : 0)}k`) : formatInt(v));
  const fmtV = (v: number) => (key === "revenueCents" ? formatMoney(v) : formatInt(v));
  const grid: number[] = [];
  for (let v = 0; v <= top; v += step) grid.push(v);
  const xTicks = [0, 7, 14, 21, 28].filter(i => i < n);
  const gaps = data.dates.flatMap((d, i) => data.series.filter(s => s[key][i] == null).map(s => ({ i, label: `${s.label} awaiting data` })));
  const sel = data.dates.indexOf(selectedDate);
  const cw = pw / Math.max(n - 1, 1);

  const onKey = (e: KeyboardEvent) => {
    const cur = hover ?? (sel >= 0 ? sel : n - 1);
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover(Math.max(0, cur - 1)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setHover(Math.min(n - 1, cur + 1)); }
    if (e.key === "Enter" && hover != null) onSelectDate(data.dates[hover]);
    if (e.key === "Escape") setHover(null);
  };

  const range = `${formatDay(data.dates[0], { month: "short", day: "numeric" })} – ${formatDay(data.dates[n - 1], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-line bg-surface px-4 pt-[18px] pb-4 shadow-xs sm:px-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Daily {metric} by marketplace</h2>
          <p className="text-[12.5px] text-ink-3">Last {n} days · {range} · click a day to open its pulse</p>
        </div>
        <div role="tablist" aria-label="Chart metric" className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]">
          {(["revenue", "customers"] as const).map(m => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} onClick={() => setMetric(m)}
              className={`h-7 rounded-md px-3 text-[12.5px] font-medium capitalize transition-colors ${metric === m ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ink-3 hover:text-ink"}`}>{m}</button>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-ink-2" aria-label="Legend">
        {data.series.map((s, i) => (
          <li key={s.channelId} className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: SERIES_COLORS[Math.min(i, 4)] }} />{s.label}</li>
        ))}
      </ul>
      <div ref={box} className="relative h-[250px] rounded-md focus-visible:outline-2 focus-visible:outline-accent" tabIndex={0} onKeyDown={onKey}
        onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
        aria-label={`Stacked ${metric} chart. Use left and right arrows to inspect a day, Enter to open it.`}>
        <svg width={W} height={H} className="block overflow-visible" role="img" aria-hidden>
          {grid.map(v => (
            <g key={v}>
              <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
              <text x={L - 10} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink3)">{fmtAxis(v)}</text>
            </g>
          ))}
          {layers.map(({ s, si, lo, hi }) => {
            const t = hi.map((v, i) => pt(i, v));
            const b = lo.map((v, i) => pt(i, v)).reverse();
            return (
              <g key={s.channelId}>
                <path d={`M${t.join("L")}L${b.join("L")}Z`} fill={SERIES_COLORS[Math.min(si, 4)]} fillOpacity={0.92} />
                <path d={`M${t.join("L")}`} fill="none" stroke="var(--surface)" strokeWidth={2} />
              </g>
            );
          })}
          {sel >= 0 && <line x1={X(sel)} x2={X(sel)} y1={6} y2={BASE} stroke="var(--ink)" strokeWidth={1.25} strokeDasharray="3 3" />}
          {gaps.map(g => (
            <g key={`${g.i}-${g.label}`}>
              <circle cx={X(g.i)} cy={Y(run[g.i])} r={4.5} fill="var(--surface)" stroke="var(--warn-icon)" strokeWidth={1.6} />
              <text x={X(g.i) - 10} y={Y(run[g.i]) - 10} textAnchor="end" fontSize={11.5} fontWeight={500} fill="var(--warn)">{g.label}</text>
            </g>
          ))}
          {xTicks.map(i => (
            <text key={i} x={X(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink3)">{formatDay(data.dates[i], { month: "short", day: "numeric" })}</text>
          ))}
          {hover != null && <line x1={X(hover)} x2={X(hover)} y1={6} y2={BASE} stroke="var(--ink3)" />}
          {data.dates.map((d, i) => (
            <rect key={d} x={X(i) - cw / 2} y={0} width={cw} height={BASE} fill="transparent" className="cursor-pointer"
              onMouseEnter={() => setHover(i)} onClick={() => onSelectDate(d)} />
          ))}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute top-2 flex w-[210px] flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px] shadow-[0_8px_24px_rgba(0,0,0,.12)]"
            style={{ left: X(hover) > W - 240 ? X(hover) - 222 : X(hover) + 12 }}>
            <p className="font-semibold">{formatDay(data.dates[hover])}</p>
            {[...data.series].reverse().map(s => {
              const v = s[key][hover];
              const color = SERIES_COLORS[Math.min(data.series.indexOf(s), 4)];
              return (
                <p key={s.channelId} className="flex items-center gap-[7px]">
                  <span className="size-2 rounded-[2px]" style={{ background: color }} />
                  <span className="flex-1 text-ink-2">{s.label}</span>
                  <span className={`font-medium ${v == null ? "text-warn" : "text-ink"}`}>{v == null ? "Awaiting data" : fmtV(v)}</span>
                </p>
              );
            })}
            <p className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Total</span><span>{fmtV(run[hover])}</span></p>
          </div>
        )}
      </div>
    </section>
  );
}
