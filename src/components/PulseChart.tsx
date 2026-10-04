"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PulseSeries } from "@/app/_lib/types";
import { formatDay, formatInt, formatMoney } from "@/app/_lib/format";
import { marketplaceColor } from "./marketplaceColors";

type PulseChartProps = {
  data: PulseSeries;        // channels in stack order, largest first → bottom
  selectedDate: string;
  lastCompleteDate: string; // days after this are partial and stay out of the average
  onSelectDate: (date: string) => void;
};

type Metric = "revenue" | "customers";
type Layout = "stacked" | "multiples";

const L = 52, AXIS = 26;
const STACK_TOP = 18, STACK_H = 270;
const PANEL_H = 64, PANEL_GAP = 24, PANELS_TOP = 20;

/** A round axis top just above the max: the smallest top among 1/2/2.5/5 steps that gives 3–7 ticks. */
export function niceScale(max: number) {
  const m = Math.max(max, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(m)));
  let best: { step: number; top: number } | null = null;
  for (const e of [mag / 10, mag]) {
    for (const k of [1, 2, 2.5, 5]) {
      const step = k * e, top = step * Math.ceil(m / step), ticks = top / step;
      if (ticks < 3 || ticks > 7) continue;
      if (!best || top < best.top || (top === best.top && step > best.step)) best = { step, top };
    }
  }
  return best ?? { step: mag, top: mag * Math.ceil(m / mag) };
}

const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
const short = (d: string) => formatDay(d, { month: "short", day: "numeric" });

const segmentBtn = (on: boolean) =>
  `h-7 rounded-md px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ink-3 hover:text-ink"}`;

export function PulseChart({ data, selectedDate, lastCompleteDate, onSelectDate }: PulseChartProps) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [layout, setLayout] = useState<Layout>("stacked");
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(1096);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data.dates.length;
  const key = metric === "revenue" ? "revenueCents" : "customers";
  const R = W - 8, pw = R - L;
  const X = (i: number) => L + (pw * i) / Math.max(n - 1, 1);
  const cw = pw / Math.max(n - 1, 1);
  const fmtAxis = (v: number) => key === "revenueCents" ? (v === 0 ? "$0" : v < 100000 ? `$${v / 100}` : `$${+(v / 100000).toFixed(1)}k`) : formatInt(v);
  const fmtV = (v: number) => (key === "revenueCents" ? formatMoney(v) : formatInt(v));
  const fmtWhole = (v: number) => (key === "revenueCents" ? `$${formatInt(v / 100)}` : formatInt(v));

  // Stack: missing values add nothing (they are flagged, never drawn as zero-height data).
  let run = Array<number>(n).fill(0);
  const layers = data.series.map(s => {
    const lo = run.slice();
    run = run.map((v, i) => v + (s[key][i] ?? 0));
    return { s, lo, hi: run.slice() };
  });

  // Average daily total over the window: complete days where every marketplace reported.
  const avgDays = data.dates.map((d, i) => i).filter(i => data.dates[i] <= lastCompleteDate && data.series.every(s => s[key][i] != null));
  const avg = avgDays.length ? avgDays.reduce((a, i) => a + run[i], 0) / avgDays.length : null;

  const sel = data.dates.indexOf(selectedDate);
  const H = layout === "stacked" ? STACK_H : PANELS_TOP + data.series.length * (PANEL_H + PANEL_GAP) - PANEL_GAP + AXIS;
  const BASE = H - AXIS;
  const plotTop = layout === "stacked" ? STACK_TOP : PANELS_TOP;
  const xTicks = [0, 7, 14, 21, 28].filter(i => i < n);

  const onKey = (e: KeyboardEvent) => {
    const cur = hover ?? (sel >= 0 ? sel : n - 1);
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover(Math.max(0, cur - 1)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setHover(Math.min(n - 1, cur + 1)); }
    if (e.key === "Enter" && hover != null) onSelectDate(data.dates[hover]);
    if (e.key === "Escape") setHover(null);
  };

  const range = `${short(data.dates[0])} – ${formatDay(data.dates[n - 1], { month: "short", day: "numeric", year: "numeric" })}`;
  const band = (i: number) => {
    const x0 = Math.max(L, X(i) - cw / 2), x1 = Math.min(R, X(i) + cw / 2);
    return { x: x0, width: Math.max(0, x1 - x0) };
  };

  // Column decorations shared by both layouts, drawn under the data.
  const backdrop = (
    <>
      {data.dates.map((d, i) => isWeekend(d) && <rect key={d} {...band(i)} y={plotTop - 6} height={BASE - plotTop + 6} fill="var(--ink)" fillOpacity={0.045} />)}
    </>
  );
  // Drawn over the data so the selected column tints the areas instead of hiding behind them.
  const selectedMarker = sel >= 0 && (
    <g>
      <rect {...band(sel)} y={plotTop - 6} height={BASE - plotTop + 6} fill="var(--accent)" fillOpacity={0.16} />
      <line x1={X(sel)} x2={X(sel)} y1={plotTop - 6} y2={BASE} stroke="var(--ink)" strokeWidth={2} />
      <text x={Math.min(Math.max(X(sel), L + 26), R - 26)} y={plotTop - 9} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)"
        stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">{short(selectedDate)}</text>
    </g>
  );

  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-line bg-surface px-4 pt-[18px] pb-4 shadow-xs sm:px-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Daily {metric} by marketplace</h2>
          <p className="text-[12.5px] text-ink-3">
            Last {n} days · {range} · click a day to open its pulse{layout === "multiples" ? " · each marketplace on its own scale" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="Chart metric" className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]">
            {(["revenue", "customers"] as const).map(m => (
              <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={segmentBtn(metric === m)}>{m === "revenue" ? "Revenue" : "Unique customers"}</button>
            ))}
          </div>
          <div role="group" aria-label="Chart layout" className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]">
            {([["stacked", "Stacked"], ["multiples", "By marketplace"]] as const).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={layout === v} onClick={() => setLayout(v)} className={segmentBtn(layout === v)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-ink-2" aria-label="Legend">
        {data.series.map(s => (
          <li key={s.channelId} className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: marketplaceColor(s.channelId) }} />{s.label}</li>
        ))}
        <li className="flex items-center gap-1.5 text-ink-3"><span className="size-2.5 rounded-[3px] border border-line bg-surface-2" />Weekend</li>
        {layout === "stacked" && avg != null && (
          <li className="flex items-center gap-1.5 text-ink-3"><span className="w-3.5 border-t-[1.5px] border-dashed border-ink-3" />{avgDays.length}-day average</li>
        )}
      </ul>
      <div ref={box} className="relative rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style={{ height: H }} tabIndex={0} onKeyDown={onKey}
        onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
        aria-label={`${layout === "stacked" ? "Stacked" : "Per-marketplace"} ${metric} chart. Use left and right arrows to inspect a day, Enter to open it.`}>
        <svg width={W} height={H} className="block overflow-visible" role="img" aria-hidden>
          {backdrop}
          {layout === "stacked" ? (() => {
            const { step, top } = niceScale(Math.max(...run, 1));
            const ph = BASE - STACK_TOP;
            const Y = (v: number) => STACK_TOP + ph * (1 - v / top);
            const pt = (i: number, v: number) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
            const grid: number[] = [];
            for (let v = 0; v <= top + 1e-9; v += step) grid.push(v);
            const gaps = data.dates.flatMap((d, i) => data.series.filter(s => s[key][i] == null).map(s => ({ i, label: `${s.label} awaiting data` })));
            return (
              <>
                {grid.map(v => (
                  <g key={v}>
                    <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
                    <text x={L - 10} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink3)">{fmtAxis(v)}</text>
                  </g>
                ))}
                {layers.map(({ s, lo, hi }) => {
                  const t = hi.map((v, i) => pt(i, v));
                  const b = lo.map((v, i) => pt(i, v)).reverse();
                  return (
                    <g key={s.channelId}>
                      <path d={`M${t.join("L")}L${b.join("L")}Z`} fill={marketplaceColor(s.channelId)} fillOpacity={0.9} />
                      <path d={`M${t.join("L")}`} fill="none" stroke="var(--surface)" strokeWidth={2} />
                    </g>
                  );
                })}
                {avg != null && (
                  <g>
                    <line x1={L} x2={R} y1={Y(avg)} y2={Y(avg)} stroke="var(--ink2)" strokeWidth={1.25} strokeDasharray="5 4" />
                    <text x={L + 6} y={Y(avg) - 6} fontSize={11} fontWeight={500} fill="var(--ink2)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
                      {avgDays.length}-day avg {fmtWhole(avg)}
                    </text>
                  </g>
                )}
                {selectedMarker}
                {sel >= 0 && <circle cx={X(sel)} cy={Y(run[sel])} r={4.5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />}
                {gaps.map(g => (
                  <g key={`${g.i}-${g.label}`}>
                    <circle cx={X(g.i)} cy={Y(run[g.i])} r={4.5} fill="var(--surface)" stroke="var(--warn-icon)" strokeWidth={1.6} />
                    <text x={X(g.i) - 10} y={Y(run[g.i]) - 10} textAnchor="end" fontSize={11.5} fontWeight={500} fill="var(--warn)">{g.label}</text>
                  </g>
                ))}
                {hover != null && <line x1={X(hover)} x2={X(hover)} y1={STACK_TOP - 6} y2={BASE} stroke="var(--ink3)" />}
              </>
            );
          })() : (
            <>
              {data.series.map((s, p) => {
                const top0 = PANELS_TOP + p * (PANEL_H + PANEL_GAP), base = top0 + PANEL_H;
                const vals = s[key];
                const { top } = niceScale(Math.max(...vals.map(v => v ?? 0), 1));
                const Y = (v: number) => top0 + PANEL_H * (1 - v / top);
                // Break the line where a day is missing instead of drawing it as zero.
                const segs: string[][] = [];
                vals.forEach((v, i) => {
                  if (v == null) return;
                  if (i === 0 || vals[i - 1] == null) segs.push([]);
                  segs[segs.length - 1].push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
                });
                const color = marketplaceColor(s.channelId);
                return (
                  <g key={s.channelId}>
                    <line x1={L} x2={R} y1={base} y2={base} stroke="var(--line)" />
                    <line x1={L} x2={R} y1={top0} y2={top0} stroke="var(--line2)" />
                    <text x={L - 10} y={top0 + 4} textAnchor="end" fontSize={11} fill="var(--ink3)">{fmtAxis(top)}</text>
                    <text x={L - 10} y={base + 4} textAnchor="end" fontSize={11} fill="var(--ink3)">{fmtAxis(0)}</text>
                    <text x={L} y={top0 - 7} fontSize={11.5} fontWeight={600} fill="var(--ink2)">{s.label}</text>
                    {segs.map((seg, k) => (
                      <g key={k}>
                        {seg.length > 1 && <path d={`M${seg[0].split(",")[0]},${base}L${seg.join("L")}L${seg[seg.length - 1].split(",")[0]},${base}Z`} fill={color} fillOpacity={0.14} />}
                        <path d={`M${seg.join("L")}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                      </g>
                    ))}
                    {vals.map((v, i) => v == null && <circle key={i} cx={X(i)} cy={base} r={4} fill="var(--surface)" stroke="var(--warn-icon)" strokeWidth={1.6} />)}
                    {sel >= 0 && vals[sel] != null && <circle cx={X(sel)} cy={Y(vals[sel]!)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
                  </g>
                );
              })}
              {selectedMarker}
              {hover != null && <line x1={X(hover)} x2={X(hover)} y1={PANELS_TOP - 6} y2={BASE} stroke="var(--ink3)" />}
            </>
          )}
          {xTicks.map(i => (
            <text key={i} x={X(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink3)">{short(data.dates[i])}</text>
          ))}
          {data.dates.map((d, i) => (
            <rect key={d} x={X(i) - cw / 2} y={0} width={cw} height={BASE} fill="transparent" className="cursor-pointer"
              onMouseEnter={() => setHover(i)} onClick={() => onSelectDate(d)} />
          ))}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute top-2 flex w-[210px] flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12.5px] shadow-[0_8px_24px_rgba(0,0,0,.12)]"
            style={{ left: X(hover) > W - 240 ? Math.max(0, X(hover) - 222) : X(hover) + 12 }}>
            <p className="font-semibold">{formatDay(data.dates[hover])}{isWeekend(data.dates[hover]) && <span className="font-normal text-ink-3"> · weekend</span>}</p>
            {[...data.series].reverse().map(s => {
              const v = s[key][hover];
              return (
                <p key={s.channelId} className="flex items-center gap-[7px]">
                  <span className="size-2 rounded-[2px]" style={{ background: marketplaceColor(s.channelId) }} />
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
