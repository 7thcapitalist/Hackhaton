/** Helpers shared by the /api/views/* route handlers (not a route itself). */
import { NextResponse } from "next/server";
import { redactSecrets } from "@/db/env";
import { addDays, businessDateOf, isValidDate, isValidPeriod, previousPeriod } from "@/lib/views/dates";

export class BadRequest extends Error {}

export function badRequest(message: string): never {
  throw new BadRequest(message);
}

/** Today's business date in Indianapolis. */
export function todayBusinessDate(): string {
  return businessDateOf(new Date());
}

export function yesterdayBusinessDate(): string {
  return addDays(todayBusinessDate(), -1);
}

export function currentPeriod(): string {
  return todayBusinessDate().slice(0, 7);
}

export function lastFullPeriod(): string {
  return previousPeriod(currentPeriod());
}

export function dateParam(params: URLSearchParams, name: string, fallback?: () => string): string {
  const v = params.get(name);
  if (v === null || v === "") {
    if (fallback) return fallback();
    badRequest(`Missing ?${name}=YYYY-MM-DD`);
  }
  if (!isValidDate(v)) badRequest(`Invalid ${name} "${v}": expected YYYY-MM-DD`);
  return v;
}

export function periodParam(params: URLSearchParams, name: string, fallback?: () => string): string {
  const v = params.get(name);
  if (v === null || v === "") {
    if (fallback) return fallback();
    badRequest(`Missing ?${name}=YYYY-MM`);
  }
  if (!isValidPeriod(v)) badRequest(`Invalid ${name} "${v}": expected YYYY-MM`);
  return v;
}

export function intParam(params: URLSearchParams, name: string, min: number, max: number): number | undefined {
  const v = params.get(name);
  if (v === null || v === "") return undefined;
  if (!/^\d+$/.test(v)) badRequest(`Invalid ${name} "${v}": expected an integer`);
  const n = Number(v);
  if (n < min || n > max) badRequest(`Invalid ${name} ${n}: expected ${min}..${max}`);
  return n;
}

/** Runs a view and maps errors to JSON (400 for bad params, 500 otherwise). */
export async function respond(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof BadRequest) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = root instanceof Error ? root.message : String(root);
    console.error("view error:", redactSecrets(message));
    return NextResponse.json({ error: redactSecrets(message) }, { status: 500 });
  }
}
