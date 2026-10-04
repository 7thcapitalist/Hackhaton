"use client";
import { Button } from "@/components/Button";
import { WarnIcon } from "@/components/icons";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span className="grid size-10 place-items-center rounded-lg bg-warn-soft text-warn-icon"><WarnIcon className="size-5" /></span>
        <h1 className="text-lg font-semibold">Couldn&apos;t load the data</h1>
        <p className="text-[13.5px] text-pretty text-ink-2">The database didn&apos;t answer. Check that it is reachable and seeded, then try again.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
