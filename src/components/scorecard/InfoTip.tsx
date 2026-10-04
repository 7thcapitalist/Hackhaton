import { Tooltip } from "../Tooltip";

/** An (i) that shows a KPI's note on hover or keyboard focus. */
export function InfoTip({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip text={text} maxWidth={300} align="start">
      <button type="button" aria-label={`About ${label}: ${text}`}
        className="grid size-4 place-items-center rounded-full text-ink-4 transition-colors hover:text-ink-2 focus-visible:text-ink-2 focus-visible:outline-2 focus-visible:outline-accent">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden className="size-3.5">
          <circle cx="8" cy="8" r="6.25" /><path d="M8 7.2v3.8M8 5v.01" strokeLinecap="round" strokeWidth={1.7} />
        </svg>
      </button>
    </Tooltip>
  );
}
