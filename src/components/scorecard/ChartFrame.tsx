import type { ReactNode } from "react";

type ChartFrameProps = {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Title, one-line explanation and legend above a chart inside a pillar section. */
export function ChartFrame({ title, subtitle, legend, children, className = "" }: ChartFrameProps) {
  return (
    <figure className={`m-0 flex min-w-0 flex-col gap-2.5 break-inside-avoid ${className}`}>
      <figcaption className="flex flex-col gap-1">
        <span className="text-[13.5px] font-semibold text-ink">{title}</span>
        {subtitle && <span className="text-[12.5px] leading-snug text-ink-3">{subtitle}</span>}
      </figcaption>
      {legend && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Legend">{legend}</ul>}
      {children}
    </figure>
  );
}

/** A legend entry: a short line or a swatch beside the label (identity never rides on color alone). */
export function LegendItem({ kind, color, children }: { kind: "line" | "dash" | "swatch"; color: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {kind === "swatch"
        ? <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: color }} />
        : <span aria-hidden className={`w-4 ${kind === "dash" ? "border-t-[1.5px] border-dashed" : "border-t-2"}`} style={{ borderColor: color }} />}
      {children}
    </li>
  );
}
