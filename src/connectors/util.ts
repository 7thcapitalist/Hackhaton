/**
 * Shared helpers for connectors: business-day ranges, HTTP with retries,
 * local folders (drop folders, fixtures), deterministic randomness.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { zonedToUtc } from "@/sources/_shared/marketplace";
import { ConnectorError, type PulledFile, type PullRange } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 62;

export function assertRange(r: PullRange): void {
  const valid = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`);
    return DATE_RE.test(d) && !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  };
  if (!valid(r.from) || !valid(r.to)) throw new Error(`from/to must be valid YYYY-MM-DD dates (got ${r.from}..${r.to})`);
  if (r.from > r.to) throw new Error(`from ${r.from} is after to ${r.to}`);
  if (daysIn(r).length > MAX_RANGE_DAYS) throw new Error(`range is longer than ${MAX_RANGE_DAYS} days`);
}

/** Every YYYY-MM-DD from `from` to `to`, inclusive. */
export function daysIn(r: PullRange): string[] {
  const out: string[] = [];
  const d = new Date(`${r.from}T12:00:00Z`);
  const end = new Date(`${r.to}T12:00:00Z`);
  while (d <= end && out.length <= MAX_RANGE_DAYS + 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Indianapolis local wall-clock time on `day` → UTC Date. */
export function localTime(day: string, h = 0, mi = 0, s = 0): Date {
  const [y, mo, d] = day.split("-").map(Number);
  return zonedToUtc(y, mo, d, h, mi, s);
}

/** UTC window [start, end) of one Indianapolis business day. */
export function dayWindow(day: string): { start: Date; end: Date } {
  return { start: localTime(day), end: localTime(nextDay(day)) };
}

export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function hasEnv(names: string[]): boolean {
  return names.every((n) => env(n) !== undefined);
}

export function jsonFile(fileName: string, body: unknown): PulledFile {
  return { fileName, bytes: Buffer.from(JSON.stringify(body, null, 2), "utf8") };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Retries for 429 / 5xx / network errors. */
  retries?: number;
  timeoutMs?: number;
}

/** fetch with timeout and retries. Error messages never include request headers. */
export async function http(sourceId: string, url: string, opts: HttpOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        body: opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
        await sleep(Math.min(wait, 10_000));
        continue;
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        throw new ConnectorError(sourceId, `${opts.method ?? "GET"} ${redactUrl(url)} → HTTP ${res.status} ${text}`, res.status);
      }
      return res;
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw new ConnectorError(sourceId, `${redactUrl(url)}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function httpJson<T = unknown>(sourceId: string, url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await http(sourceId, url, opts);
  return (await res.json()) as T;
}

/** Drop query strings (pre-signed download URLs carry signatures). */
export function redactUrl(url: string): string {
  return url.replace(/\?.*$/, "?…");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Local folders
// ---------------------------------------------------------------------------

const FILE_EXT = /\.(csv|tsv|txt|xlsx|json)$/i;

/** Root of data/ (drop folders and fixtures). Override with CONNECTOR_DATA_DIR. */
export function dataDir(): string {
  return env("CONNECTOR_DATA_DIR") ?? join(process.cwd(), "data");
}

export interface LocalFile {
  path: string;
  name: string;
  mtimeMs: number;
}

/** Ingestible files directly inside `dir` (none if it does not exist). */
export function listFiles(dir: string): LocalFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => FILE_EXT.test(n) && !n.startsWith("."))
    .map((name) => {
      const path = join(dir, name);
      return { path, name, mtimeMs: statSync(path).mtimeMs };
    })
    .filter((f) => statSync(f.path).isFile());
}

/**
 * Does a file name's date fall in the range? YYYY-MM-DD must be inside it;
 * YYYY-MM must overlap it. Names without a date return null (unknown).
 */
export function nameInRange(name: string, r: PullRange): boolean | null {
  const day = /(\d{4}-\d{2}-\d{2})/.exec(name)?.[1];
  if (day) return day >= r.from && day <= r.to;
  const month = /(\d{4}-\d{2})(?!-?\d)/.exec(name)?.[1];
  if (month) return month >= r.from.slice(0, 7) && month <= r.to.slice(0, 7);
  return null;
}

/** Files whose name dates fall in the range. */
export function filesInRange(files: LocalFile[], r: PullRange): LocalFile[] {
  return files.filter((f) => nameInRange(f.name, r) === true).sort((a, b) => a.name.localeCompare(b.name));
}

export function newest(files: LocalFile[]): LocalFile | undefined {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))[0];
}

export function readLocal(f: LocalFile, prefix: string): PulledFile {
  return { fileName: `${prefix}${f.name}`, bytes: readFileSync(f.path) };
}

// ---------------------------------------------------------------------------
// Deterministic randomness for mocks (same range → same bytes → idempotent)
// ---------------------------------------------------------------------------

export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32 PRNG. */
export function rng(seed: string) {
  let a = seedOf(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    digits: (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(""),
    hex: (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join(""),
  };
}
export type Rng = ReturnType<typeof rng>;

/** cents → "12.34" */
export function dec(cents: number, places = 2): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toFixed(places);
  return neg ? `-${s}` : s;
}

/** Sorted local times for `n` events on a day, 07:00–21:59, plus an optional late one (23:xx). */
export function eventTimes(r: Rng, day: string, n: number, late = true): Date[] {
  const mins = Array.from({ length: n }, () => r.int(7 * 60, 21 * 60 + 59)).sort((a, b) => a - b);
  const out = mins.map((m) => localTime(day, Math.floor(m / 60), m % 60, r.int(0, 59)));
  if (late && n > 0) out[n - 1] = localTime(day, 23, r.int(30, 55), r.int(0, 59));
  return out;
}
