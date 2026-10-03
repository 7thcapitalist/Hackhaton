/** Maps close errors to JSON responses for the /api/close/* routes. */
import { NextResponse } from "next/server";
import { redactSecrets } from "@/db/env";
import { CloseError } from "./common";

export function closeErrorResponse(err: unknown, tag = "api/close"): NextResponse {
  if (err instanceof CloseError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
  }
  const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const message = redactSecrets(root instanceof Error ? root.message : String(root));
  console.error(`[${tag}]`, message);
  return NextResponse.json({ error: message, code: "internal" }, { status: 500 });
}
