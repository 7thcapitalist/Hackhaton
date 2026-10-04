/**
 * PATCH /api/exceptions/:id  body { status: "resolved" | "waived" | "open", note?: string }
 * -> the updated ExceptionRow. resolved/waived set resolved_at = now; open clears it.
 * A note is appended to the exception message. 400 bad body, 404 unknown id.
 */
import { NextResponse } from "next/server";
import { redactSecrets } from "@/db/env";
import { EXCEPTION_STATUSES, setExceptionStatus, type ExceptionStatus } from "@/lib/views";
import { invalidateViews } from "@/lib/views/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body { status, note? }" }, { status: 400 });
  }
  const { status, note } = (body ?? {}) as { status?: unknown; note?: unknown };
  if (typeof status !== "string" || !EXCEPTION_STATUSES.includes(status as ExceptionStatus)) {
    return NextResponse.json(
      { error: `status must be one of ${EXCEPTION_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }

  try {
    const row = await setExceptionStatus(id, {
      status: status as ExceptionStatus,
      note: typeof note === "string" ? note : undefined,
    });
    if (!row) return NextResponse.json({ error: `Exception "${id}" not found` }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = redactSecrets(root instanceof Error ? root.message : String(root));
    console.error("[api/exceptions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Writes to the database, so cached view results are dropped afterwards. */
export async function PATCH(...args: Parameters<typeof handlePATCH>) {
  try {
    return await handlePATCH(...args);
  } finally {
    invalidateViews();
  }
}
