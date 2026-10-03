/**
 * GET /api/views/exceptions?status=open|resolved|waived&sourceId=&kind=&period=YYYY-MM&limit=1..1000&offset=0..
 * -> ExceptionsView. All params optional. Default limit 100, newest first.
 */
import type { NextRequest } from "next/server";
import {
  EXCEPTION_KINDS,
  EXCEPTION_STATUSES,
  EXCEPTIONS_MAX_LIMIT,
  getExceptions,
  type ExceptionKind,
  type ExceptionStatus,
} from "@/lib/views";
import { badRequest, intParam, periodParam, respond } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enumParam<T extends string>(p: URLSearchParams, name: string, allowed: readonly T[]): T | undefined {
  const v = p.get(name) || undefined;
  if (v !== undefined && !allowed.includes(v as T)) {
    badRequest(`Invalid ${name} "${v}": expected one of ${allowed.join(", ")}`);
  }
  return v as T | undefined;
}

export async function GET(req: NextRequest) {
  return respond(async () => {
    const p = req.nextUrl.searchParams;
    return getExceptions({
      status: enumParam<ExceptionStatus>(p, "status", EXCEPTION_STATUSES),
      kind: enumParam<ExceptionKind>(p, "kind", EXCEPTION_KINDS),
      sourceId: p.get("sourceId") || undefined,
      period: p.get("period") ? periodParam(p, "period") : undefined,
      limit: intParam(p, "limit", 1, EXCEPTIONS_MAX_LIMIT),
      offset: intParam(p, "offset", 0, Number.MAX_SAFE_INTEGER),
    });
  });
}
