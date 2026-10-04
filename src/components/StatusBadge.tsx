import type { ReactNode } from "react";
import type { BadgeStatus } from "@/app/_lib/types";
import { CheckIcon, DashedRingIcon, WarnIcon } from "./icons";

const config: Record<BadgeStatus, { label: string; tone: string; mark: ReactNode }> = {
  ok: { label: "Live", tone: "bg-ok-soft text-ok", mark: <span className="size-[7px] rounded-full bg-ok" /> },
  simulated: { label: "Simulated", tone: "bg-warn-soft text-warn", mark: <span className="size-1.5 rotate-45 rounded-[1px] bg-warn-icon" /> },
  awaiting_data: { label: "Awaiting data", tone: "bg-muted-soft text-muted", mark: <span className="size-[7px] rounded-full border-[1.5px] border-muted" /> },
  received: { label: "Received", tone: "bg-ok-soft text-ok", mark: <CheckIcon className="size-[11px]" /> },
  warnings: { label: "Warnings", tone: "bg-warn-soft text-warn", mark: <WarnIcon className="size-3 text-warn-icon" /> },
  missing: { label: "Missing", tone: "bg-muted-soft text-muted", mark: <DashedRingIcon className="size-[11px]" /> },
  not_due: { label: "Not due yet", tone: "bg-muted-soft text-muted", mark: <span className="size-[7px] rounded-full border-[1.5px] border-muted" /> },
};

/** Color is always paired with a distinct shape and a text label. */
export function StatusBadge({ status, count, label, size = "md" }: { status: BadgeStatus; count?: number; label?: string; size?: "sm" | "md" }) {
  const c = config[status];
  const text = label ?? (status === "warnings" && count ? `${count} warning${count > 1 ? "s" : ""}` : c.label);
  const sizing = size === "sm" ? "gap-[5px] py-px pr-[7px] pl-1.5 text-[11px]" : "gap-1.5 py-0.5 pr-2 pl-1.5 text-[11.5px]";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap ${sizing} ${c.tone}`}>
      {c.mark}
      {text}
    </span>
  );
}

/** The Live / Simulated / Awaiting legend shown on the scorecard header. */
export function StatusLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-ink-3">
      <span className="flex items-center gap-[5px]"><span className="size-[7px] rounded-full bg-ok" />Live</span>
      <span className="flex items-center gap-[5px]"><span className="size-1.5 rotate-45 bg-warn-icon" />Simulated</span>
      <span className="flex items-center gap-[5px]"><span className="size-[7px] rounded-full border-[1.5px] border-muted" />Awaiting data</span>
    </div>
  );
}
