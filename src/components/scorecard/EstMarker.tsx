import { Tooltip } from "../Tooltip";

export const EST_HINT = "Estimated from synthetic item/labor data";

/** Provenance, not performance: a neutral marker (no status color) next to an estimated value. */
export function EstMarker() {
  return (
    <Tooltip text={EST_HINT} align="end">
      <span tabIndex={0} aria-label={EST_HINT}
        className="rounded-[4px] border border-line px-1 text-[11px] leading-[16px] font-medium text-ink-3 focus-visible:outline-2 focus-visible:outline-accent">
        est.
      </span>
    </Tooltip>
  );
}
