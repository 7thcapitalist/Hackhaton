import type { Metadata } from "next";
import { PulseScreen } from "./PulseScreen";
import { LATEST_DATE, PULSE_DATES, getPulse, getPulseSeries, getPulseTotalsFor, isPulseDate } from "../_lib/demo-data";
import { shiftDay } from "../_lib/format";

export const metadata: Metadata = { title: "Daily Pulse – Mission Control" };

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: requested } = await searchParams;
  const date = isPulseDate(requested) ? requested : LATEST_DATE;
  const view = getPulse(date);
  const reporting = view.rows.filter(r => r.status === "ok").map(r => r.channelId);
  const cmpDate = shiftDay(date, -7);
  const i = PULSE_DATES.indexOf(date);

  return (
    <PulseScreen
      view={view}
      compare={{ date: cmpDate, totals: getPulseTotalsFor(cmpDate, reporting) }}
      series={getPulseSeries()}
      prevDate={i > 0 ? PULSE_DATES[i - 1] : null}
      nextDate={i < PULSE_DATES.length - 1 ? PULSE_DATES[i + 1] : null}
      latestDate={LATEST_DATE}
    />
  );
}
