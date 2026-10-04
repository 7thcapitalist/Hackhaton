import { STATUS_META, type Status } from "@/app/scorecard/kpiFormat";

/** Status is never color alone: a distinct icon plus a text label. */
export function StatusMark({ status, short = false }: { status: Status; short?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold whitespace-nowrap ${m.fg}`}>
      <span aria-hidden className="w-3 text-center">{m.icon}</span>
      {status === "none" || status === "awaiting" ? <span className="font-normal">{short ? "—" : m.label}</span> : (short ? m.short[0].toUpperCase() + m.short.slice(1) : m.label)}
    </span>
  );
}
