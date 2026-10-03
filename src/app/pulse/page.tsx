import type { Metadata } from "next";
import { PulseScreen } from "./PulseScreen";
import { LATEST_DATE, SEED_END_DATE, getPulse, getPulseSeries, getPulseTotalsFor, isPulseDate } from "../_lib/live-data";
import { shiftDay } from "../_lib/format";

export const metadata: Metadata = { title: "Daily Pulse – Mission Control" };

// Already dynamic via `searchParams`, but marked explicitly for consistency
// with the other DB-backed pages — see the note in layout.tsx.
export const dynamic = "force-dynamic";

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: requested } = await searchParams;
  const date = isPulseDate(requested) ? requested : LATEST_DATE;
  const cmpDate = shiftDay(date, -7);

  const [view, series] = await Promise.all([getPulse(date), getPulseSeries(date)]);
  const reporting = view.rows.filter(r => r.status === "ok").map(r => r.channelId);
  const cmpTotals = await getPulseTotalsFor(cmpDate, reporting);

  return (
    <PulseScreen
      view={view}
      compare={{ date: cmpDate, totals: cmpTotals }}
      series={series}
      // The real views aren't limited to a fixed window; any valid date works.
      prevDate={shiftDay(date, -1)}
      nextDate={date < SEED_END_DATE ? shiftDay(date, 1) : null}
      latestDate={LATEST_DATE}
    />
  );
}
