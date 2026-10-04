// Pure helpers shared by the pillar charts (server and client components alike).

/** A round axis top just above the max: the smallest top among 1/2/2.5/5 steps that gives 3–6 ticks. */
export function niceScale(max: number) {
  const m = Math.max(max, 1e-9);
  const mag = Math.pow(10, Math.floor(Math.log10(m)));
  let best: { step: number; top: number } | null = null;
  for (const e of [mag / 10, mag]) {
    for (const k of [1, 2, 2.5, 5]) {
      const step = k * e, top = step * Math.ceil(m / step), ticks = top / step;
      if (ticks < 3 || ticks > 6) continue;
      if (!best || top < best.top || (top === best.top && step > best.step)) best = { step, top };
    }
  }
  return best ?? { step: mag, top: mag * Math.ceil(m / mag) };
}
