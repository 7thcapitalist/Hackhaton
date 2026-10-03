import { ClockIcon } from "./icons";

/** Shown when the database has no imported files yet. */
export function NoData() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span className="grid size-10 place-items-center rounded-[10px] bg-muted-soft text-muted"><ClockIcon className="size-5" /></span>
        <h1 className="text-lg font-semibold">No data imported yet</h1>
        <p className="text-[13.5px] text-pretty text-ink-2">
          Nothing has been imported into the database. Locally, run <code className="font-mono text-[12.5px]">npm run db:push</code> and{" "}
          <code className="font-mono text-[12.5px]">npm run seed</code>, then reload.
        </p>
      </div>
    </div>
  );
}
