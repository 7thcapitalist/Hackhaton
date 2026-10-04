"use client";
import { useEffect, useRef, useState } from "react";
import type { MonthPace } from "@/app/_lib/data";
import { formatDay, formatMoneyWhole } from "@/app/_lib/format";
import { computePace, cumulative } from "@/app/pulse/pace";

const H = 168, L = 48, R = 12, TOP = 14, AXIS = 22;

const compact = (cents: number) => {
  const d = cents / 100;
  return d >= 1000 ? `$${+(d / 1000).toFixed(d >= 100000 ? 0 : 1)}k` : `$${Math.round(d)}`;
};

/** Month-to-date revenue against a straight-line pace to the month's target, with a projection. */
export function MonthPaceCard({ pace }: { pace: MonthPace }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(480);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = computePace(pace);
  const month = formatDay(`${pace.period}-01`, { month: "long" });
  const N = pace.daysInMonth;
  const run = cumulative(pace.daily);
  const top = Math.max(pace.targetCents ?? 0, p.projectedCents, p.mtdCents, 1) * 1.08;
  const X = (day: number) => L + ((W - L - R) * day) / N;      // day 0 = start of the month
  const Y = (v: number) => TOP + (H - TOP - AXIS) * (1 - v / top);
  const actual = [`${X(0)},${Y(0)}`, ...run.map((v, i) => `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`)];
  const xTicks = [1, 8, 15, 22, N].filter((d, i, a) => d <= N && a.indexOf(d) === i);
  const ahead = p.status === "ahead";
  const badge = { ahead: ["✓", "Ahead of pace", "bg-ok-soft text-ok"], near: ["◐", "Near pace", "bg-warn-soft text-warn"], behind: ["✕", "Behind pace", "bg-bad-soft text-bad"] } as const;

  return (
    <section aria-labelledby="pace-title" className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface px-5.5 py-5 shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 id="pace-title" className="text-[15px] font-semibold">Month to date · {month}</h2>
          <p className="text-[12.5px] text-ink-3">
            {pace.through ? `Through ${formatDay(pace.through, { month: "short", day: "numeric" })} · ${p.elapsedDays} of ${N} days` : "No complete day yet this month"}
          </p>
        </div>
        {p.status !== "none" && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${badge[p.status][2]}`}>
            <span aria-hidden>{badge[p.status][0]}</span>{badge[p.status][1]}
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[30px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{formatMoneyWhole(p.mtdCents)}</span>
        {pace.targetCents != null && (
          <span className="text-[13px] text-ink-2 tabular-nums">of {formatMoneyWhole(pace.targetCents)} target ({Math.round(p.pctOfTarget ?? 0)}%)</span>
        )}
      </div>
      {p.status !== "none" && (
        <p className="text-[13px] text-pretty text-ink-2 tabular-nums">
          {formatMoneyWhole(Math.abs(p.gapCents!))} {ahead ? "ahead of" : "behind"} the {formatMoneyWhole(p.expectedCents!)} a straight-line pace needs by now.
          {" "}At this rate the month ends near <strong className="font-semibold text-ink">{formatMoneyWhole(p.projectedCents)}</strong>.
        </p>
      )}

      {pace.through && (
        <div ref={box} className="w-full">
          <svg width={W} height={H} className="block overflow-visible" role="img"
            aria-label={`Cumulative revenue ${formatMoneyWhole(p.mtdCents)} after ${p.elapsedDays} days${pace.targetCents ? `, target ${formatMoneyWhole(pace.targetCents)}, projected ${formatMoneyWhole(p.projectedCents)}` : ""}`}>
            {[0, pace.targetCents ?? null].filter((v): v is number => v != null).map(v => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--line2)" />
                <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink3)">{compact(v)}</text>
              </g>
            ))}
            {pace.targetCents != null && <>
              <line x1={X(0)} y1={Y(0)} x2={X(N)} y2={Y(pace.targetCents)} stroke="var(--ink4)" strokeWidth={1.25} strokeDasharray="5 4" />
              <text x={X(N) - 2} y={Y(pace.targetCents) - 6} textAnchor="end" fontSize={11} fontWeight={500} fill="var(--ink2)">Target pace</text>
            </>}
            {p.elapsedDays < N && (
              <line x1={X(p.elapsedDays)} y1={Y(p.mtdCents)} x2={X(N)} y2={Y(p.projectedCents)} stroke="var(--accent)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="1.5 4.5" strokeLinecap="round" />
            )}
            <path d={`M${actual.join("L")}`} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={X(p.elapsedDays)} cy={Y(p.mtdCents)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
            {xTicks.map(d => (
              <text key={d} x={X(d)} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--ink3)">{formatDay(`${pace.period}-${String(d).padStart(2, "0")}`, { month: "short", day: "numeric" })}</text>
            ))}
          </svg>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-accent" />Actual</li>
            {pace.targetCents != null && <li className="flex items-center gap-1.5"><span className="w-4 border-t-[1.5px] border-dashed border-ink-4" />Target pace</li>}
            {p.elapsedDays < N && <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-accent/60" />Projection</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
