import type { Metadata } from "next";
import { PulseScreen } from "./PulseScreen";
import { getCategoryMix, getDataRange, getMonthPace, getPulseBaseline, getPulseScreen, resolveDate } from "../_lib/data";

export const metadata: Metadata = { title: "Daily Pulse – Mission Control" };

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const date = resolveDate(range, (await searchParams).date);
  const data = await getPulseScreen(range, date);
  const [baseline, pace, categoryMix] = await Promise.all([
    getPulseBaseline(range, data.view),
    getMonthPace(range, date),
    getCategoryMix(range, date, data.orders, data.ordersTotal),
  ]);
  return <PulseScreen {...data} baseline={baseline} pace={pace} categoryMix={categoryMix} latestDate={range.completeDate} />;
}
