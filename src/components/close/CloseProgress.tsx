import { CheckIcon, DashedRingIcon, WarnIcon } from "../icons";
import { STAGES, STAGE_LABEL, type CloseStage, type CloseStep } from "./types";

/** Status pill with the full lifecycle as a tooltip: collecting → … → posted. */
export function StagePill({ stage }: { stage: CloseStage }) {
  const i = STAGES.indexOf(stage);
  const tone = stage === "posted" ? "bg-ok-soft text-ok" : stage === "collecting" ? "bg-muted-soft text-muted" : "bg-accent-soft text-accent";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] py-0.5 pr-2 pl-1.5 text-[12px] font-medium whitespace-nowrap ${tone}`}
      title={STAGES.map(s => STAGE_LABEL[s]).join(" → ")}>
      {stage === "posted" ? <CheckIcon className="size-[11px]" /> : <span className="size-[7px] rounded-full bg-current" />}
      {STAGE_LABEL[stage]}
      <span className="font-medium opacity-70">· {i + 1} of {STAGES.length}</span>
    </span>
  );
}

const MARK = {
  done: { icon: <CheckIcon className="size-3" />, ring: "bg-ok text-surface", text: "Done" },
  warning: { icon: <WarnIcon className="size-3" />, ring: "bg-warn-soft text-warn-icon border border-warn-icon", text: "Needs review" },
  todo: { icon: <DashedRingIcon className="size-3" />, ring: "bg-surface text-muted border border-line", text: "To do" },
};

/** Slide 40: the target close in six steps, each with its state and one line of detail. */
export function CloseStepper({ steps, derived }: { steps: CloseStep[]; derived: boolean }) {
  return (
    <section aria-labelledby="steps-h" className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-[18px] py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="steps-h" className="text-sm font-semibold">Target close · six steps</h2>
        <span className="text-xs text-ink-3">{steps.filter(s => s.status === "done").length} of {steps.length} done{derived ? " · worked out from this page's data" : ""}</span>
      </header>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {steps.map((s, i) => {
          const m = MARK[s.status] ?? MARK.todo;
          return (
            <li key={s.key} className={`flex min-w-0 gap-2.5 rounded-lg border px-3 py-2.5 ${s.status === "warning" ? "border-warn-icon/40 bg-warn-soft/50" : "border-line-2 bg-surface-2"}`}>
              <span className={`mt-px grid size-[22px] shrink-0 place-items-center rounded-full ${m.ring}`} aria-hidden>{m.icon}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-[13px] font-semibold">
                  <span className="mr-1 font-mono text-[11px] font-medium text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                  <span className="sr-only"> — {m.text}</span>
                </p>
                <p className="text-xs text-pretty text-ink-3">{s.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
