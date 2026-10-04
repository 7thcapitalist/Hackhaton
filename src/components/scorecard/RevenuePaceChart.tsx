"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PaceSeries, RevenuePace } from "@/app/_lib/scorecard-charts";
import { formatDay, formatMoneyWhole } from "@/app/_lib/format";
import { niceScale } from "./chartScale";
import { ChartFrame, LegendItem } from "./ChartFrame";

const L = 48, TOP = 14, PLOT_H = 176, AXIS = 24;
const H = TOP + PLOT_H + AXIS;
const CUR = "var(--accent)", LY = "var(--ink4)", TARGET = "var(--ink2)";

const axisMoney = (c: number) => (c === 0 ? "$0" : `$${+(c / 100000).toFixed(1)}k`);
const pctDiff = (a: number, b: number) => ((a - b) / b) * 100;

/** Cumulative revenue through the month: this month, the same month last year, and a straight-line pace to the target. */
export function RevenuePaceChart({ data }: { data: RevenuePace }) {
  const { days: D, targetCents: T, current, lastYear } = data;
  const [W, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null); // 1-based day
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // A collapsed section reports width 0: keep the last real width.
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w >= 200) setW(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const R = W - 6, pw = R - L;
  const X = (day: number) => L + (pw * (day - 1)) / Math.max(D - 1, 1);
  const maxV = Math.max(T ?? 0, ...current.cumulative.map(v => v ?? 0), ...(lastYear?.cumulative.map(v => v ?? 0) ?? [0]), 1);
  const { step, top } = niceScale(maxV);
  const Y = (v: number) => TOP + PLOT_H * (1 - v / top);
  const grid: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) grid.push(v);
  const pace = (day: number) => (T == null ? null : (T * day) / D);

  const month = (s: PaceSeries) => s.label.split(" ")[0];
  const dayLabel = (s: PaceSeries, day: number) => formatDay(`${s.period}-${String(day).padStart(2, "0")}`, { month: "short", day: "numeric" });

  // Compare on the last full day: a partial day would compare half a day to whole ones.
  const cmpDay = current.partialFromDay ? current.partialFromDay - 1 : current.lastDay;
  const monthDone = current.lastDay === D && !current.partialFromDay;
  const curAt = cmpDay > 0 ? current.cumulative[cmpDay - 1] : null;
  const lyAt = lastYear && cmpDay > 0 ? lastYear.cumulative[Math.min(cmpDay, lastYear.cumulative.length) - 1] : null;
  const paceAt = cmpDay > 0 ? pace(cmpDay) : null;
  const vsLy = curAt != null && lyAt ? pctDiff(curAt, lyAt) : null;
  const vsTarget = curAt != null && paceAt ? pctDiff(curAt, paceAt) : null;

  const lines = (s: PaceSeries) => {
    const solid: string[][] = [];
    const partial: string[] = [];
    s.cumulative.forEach((v, i) => {
      const day = i + 1;
      if (v == null) return;
      const p = `${X(day).toFixed(1)},${Y(v).toFixed(1)}`;
      if (s.partialFromDay != null && day >= s.partialFromDay) {
        if (partial.length === 0 && i > 0 && s.cumulative[i - 1] != null) partial.push(`${X(day - 1).toFixed(1)},${Y(s.cumulative[i - 1]!).toFixed(1)}`);
        partial.push(p);
        return;
      }
      if (i === 0 || s.cumulative[i - 1] == null) solid.push([]);
      solid[solid.length - 1].push(p);
    });
    return { solid, partial };
  };
  const cur = lines(current);
  const ly = lastYear ? lines(lastYear) : null;
  const end = current.lastDay;
  const endV = current.cumulative[end - 1]!;

  const xTicks = [1, 8, 15, 22, D];
  const onMove = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.min(D, Math.max(1, Math.round(((x - L) / pw) * (D - 1)) + 1)));
  };
  const onKey = (e: KeyboardEvent) => {
    const at = hover ?? end;
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover(Math.max(1, at - 1)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setHover(Math.min(D, at + 1)); }
    if (e.key === "Escape") setHover(null);
  };

  const fmtSigned = (p: number) => `${Math.abs(p).toFixed(1)}% ${p >= 0 ? "above" : "below"}`;
  const curMonth = month(current);
  const summary = curAt == null ? `No full day of ${current.label} yet.`
    : [
        `${formatMoneyWhole(curAt)} ${monthDone ? "for the month" : `through ${dayLabel(current, cmpDay)}`}`,
        vsLy != null && lastYear ? `${fmtSigned(vsLy)} ${monthDone ? lastYear.label : `${lastYear.label} by the same day`}` : null,
        vsTarget != null && T != null ? (monthDone ? `${fmtSigned(vsTarget)} the ${formatMoneyWhole(T)} target` : `${fmtSigned(vsTarget)} the pace to ${formatMoneyWhole(T)}`) : null,
      ].filter(Boolean).join(" · ");

  return (
    <ChartFrame
      title="Revenue, month to date"
      subtitle={<>Running total of net revenue by day{lastYear ? `, next to ${lastYear.label}` : ""}{T != null ? " and an even pace to the monthly target" : ""}.</>}
      legend={<>
        <LegendItem kind="line" color={CUR}>{current.label}</LegendItem>
        {lastYear && <LegendItem kind="line" color={LY}>{lastYear.label}</LegendItem>}
        {T != null && <LegendItem kind="dash" color={TARGET}>Target pace</LegendItem>}
        {current.partialFromDay && <LegendItem kind="dash" color={CUR}>Partial day</LegendItem>}
      </>}
    >
      <p className="text-[12.5px] text-ink-2">{summary}</p>
      <div ref={box} tabIndex={0} onKeyDown={onKey} onMouseMove={e => onMove(e.clientX)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
        className="relative w-full rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`Revenue, month to date. ${summary}. Use left and right arrows to read each day.`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-hidden>
          {grid.map(v => (
            <g key={v}>
              <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? "var(--line)" : "var(--line2)"} />
              <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink3)">{axisMoney(v)}</text>
            </g>
          ))}
          {xTicks.filter((d, i, a) => a.indexOf(d) === i && (d === D || D - d >= 4)).map(d => (
            <text key={d} x={X(d)} y={H - 6} textAnchor={d === 1 ? "start" : d === D ? "end" : "middle"} fontSize={11} fill="var(--ink3)">{`${curMonth} ${d}`}</text>
          ))}
          {T != null && <line x1={X(1)} y1={Y(pace(1)!)} x2={X(D)} y2={Y(T)} stroke={TARGET} strokeWidth={1.25} strokeDasharray="5 4" />}
          {ly && ly.solid.map((seg, k) => <path key={k} d={`M${seg.join("L")}`} fill="none" stroke={LY} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {cur.solid.map((seg, k) => (
            <g key={k}>
              {seg.length > 1 && <path d={`M${seg[0].split(",")[0]},${Y(0)}L${seg.join("L")}L${seg[seg.length - 1].split(",")[0]},${Y(0)}Z`} fill={CUR} fillOpacity={0.08} />}
              <path d={`M${seg.join("L")}`} fill="none" stroke={CUR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {cur.partial.length > 1 && <path d={`M${cur.partial.join("L")}`} fill="none" stroke={CUR} strokeWidth={2} strokeDasharray="3 3" />}
          {current.gaps.map(g => current.cumulative[g.day - 1] != null && (
            <circle key={g.day} cx={X(g.day)} cy={Y(current.cumulative[g.day - 1]!)} r={4.5} fill="var(--surface)" stroke="var(--warn-icon)" strokeWidth={1.6} />
          ))}
          <circle cx={X(end)} cy={Y(endV)} r={4.5} fill={current.partialFromDay ? "var(--surface)" : CUR} stroke={current.partialFromDay ? CUR : "var(--surface)"} strokeWidth={2} />
          {hover != null && <line x1={X(hover)} x2={X(hover)} y1={TOP} y2={Y(0)} stroke="var(--ink3)" />}
        </svg>
        {hover != null && (() => {
          const c = current.cumulative[hover - 1] ?? null;
          const l = lastYear?.cumulative[hover - 1] ?? null;
          const p = pace(hover);
          const gap = current.gaps.find(g => g.day === hover);
          const left = (X(hover) / W) * 100;
          return (
            <div data-print-hide className="pointer-events-none absolute top-0 z-10 flex w-[200px] flex-col gap-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12px] shadow-pop"
              style={left > 55 ? { right: `calc(${100 - left}% + 10px)` } : { left: `calc(${left}% + 10px)` }}>
              <p className="font-semibold text-ink">Through day {hover}</p>
              <Row color={CUR} label={dayLabel(current, hover)} value={c == null ? (hover > current.lastDay ? "Not yet" : "No data") : formatMoneyWhole(c)} />
              {lastYear && <Row color={LY} label={dayLabel(lastYear, hover) + `, ${lastYear.period.slice(0, 4)}`} value={l == null ? "No data" : formatMoneyWhole(l)} />}
              {p != null && <Row color={TARGET} dashed label="Target pace" value={formatMoneyWhole(p)} />}
              {current.partialFromDay != null && hover >= current.partialFromDay && c != null && <p className="text-ink-3">Partial day: files arrived before it ended.</p>}
              {gap && <p className="text-warn">{gap.missing.join(", ")} awaiting data</p>}
            </div>
          );
        })()}
      </div>
    </ChartFrame>
  );
}

function Row({ color, label, value, dashed = false }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <p className="flex items-center gap-2">
      <span aria-hidden className={`w-3 ${dashed ? "border-t-[1.5px] border-dashed" : "border-t-2"}`} style={{ borderColor: color }} />
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="font-medium text-ink tabular-nums">{value}</span>
    </p>
  );
}
