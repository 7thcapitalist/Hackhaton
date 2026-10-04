import type { Metadata } from "next";
import { PulseScreen } from "./PulseScreen";
import { getDataRange, getPulseBaseline, getPulseScreen, resolveDate } from "../_lib/data";

export const metadata: Metadata = { title: "Daily Pulse – Mission Control" };

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const range = (await getDataRange())!; // the layout shows NoData when null
  const date = resolveDate(range, (await searchParams).date);
  const data = await getPulseScreen(range, date);
  const baseline = await getPulseBaseline(range, data.view);
  return <PulseScreen {...data} baseline={baseline} latestDate={range.completeDate} />;
}
