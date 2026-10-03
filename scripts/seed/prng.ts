/**
 * Deterministic pseudo-random helpers for the synthetic seed.
 * Never use Math.random in the seed: same seed => same database.
 */

/** mulberry32: small, fast, good enough for synthetic data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** Uniform in [0, 1). */
  float(): number {
    return this.next();
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r < 0) return v;
    }
    return entries[entries.length - 1]![0];
  }
  /** Approximately normal (Irwin-Hall, 6 uniforms). */
  normal(mean: number, sd: number): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return mean + (s - 3) * sd * Math.SQRT2;
  }
  /** Log-normal-ish positive value around `median`. */
  logNormal(median: number, spread: number): number {
    return median * Math.exp(this.normal(0, spread));
  }
  /** Poisson-ish count (normal approximation, clamped at 0). */
  count(mean: number): number {
    return Math.max(0, Math.round(this.normal(mean, Math.sqrt(mean))));
  }
}
