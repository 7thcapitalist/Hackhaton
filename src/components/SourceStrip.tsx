import type { Source } from "@/app/_lib/types";

const order = { received: 0, warnings: 1, not_due: 2, missing: 3 } as const;

/** One segment per source: received (solid), warnings (amber), missing (dashed outline). */
export function SourceStrip({ sources, size }: { sources: Source[]; size: "sm" | "lg" }) {
  const sorted = [...sources].sort((a, b) => order[a.status] - order[b.status]);
  const arrived = sources.filter(s => s.status === "received" || s.status === "warnings").length;
  return (
    <div role="img" aria-label={`${arrived} of ${sources.length} sources received`}
      className={`grid ${size === "sm" ? "gap-[3px]" : "gap-1"}`}
      style={{ gridTemplateColumns: `repeat(${sources.length}, ${size === "sm" ? "14px" : "minmax(0, 1fr)"})` }}>
      {sorted.map(s => (
        <span key={s.id} title={`${s.name}: ${s.status}`}
          className={`${size === "sm" ? "h-1.5 rounded-[2px]" : "h-2.5 rounded-[3px]"} ${
            s.status === "received" ? "bg-ok/60" : s.status === "warnings" ? "bg-warn-icon" : "border-[1.5px] border-dashed border-ink-4"}`} />
      ))}
    </div>
  );
}
