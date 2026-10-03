type SparklineProps = { values: number[]; target?: number | null; height?: number; dashed?: boolean; tone?: "accent" | "warn"; className?: string };

/** Dependency-free, scales to its container width. Dashed = simulated data. */
export function Sparkline({ values, target = null, height = 34, dashed = false, tone = "accent", className = "" }: SparklineProps) {
  if (values.length < 2) return <div style={{ height }} className="border-t-[1.5px] border-dashed border-line" />;
  const W = 200;
  const all = target != null ? [...values, target] : values;
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 1;
  const y = (v: number) => height - 2 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (height - 4);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`);
  const stroke = tone === "warn" ? "var(--warn-icon)" : "var(--accent)";
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={`block w-full overflow-visible ${className}`} style={{ height }} aria-hidden>
      {!dashed && <path d={`M0,${height}L${pts.join("L")}L${W},${height}Z`} fill="var(--accent-soft)" />}
      {target != null && <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--ink3)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <path d={`M${pts.join("L")}`} fill="none" stroke={stroke} strokeWidth={target != null ? 2 : 1.6} strokeDasharray={dashed ? "4 3" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
