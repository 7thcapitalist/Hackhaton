/**
 * GET  /api/close/YYYY-MM → CloseView (works before a close exists).
 * POST /api/close/YYYY-MM  JSON body (optional "by": who did it, for the audit trail):
 *   { "action": "generate", "force"?: boolean }   → GenerateResult (force = rebuild an exported close)
 *   { "action": "reconcile" }                     → ReconcileResult
 *   { "action": "approve", "approvedBy": "Name", "force"?: boolean } → ApproveResult
 *     (force approves despite open exceptions and marks each one waived)
 *   { "action": "resolve_exception", "exceptionId": "…", "status": "resolved"|"waived", "by": "Name", "note"?: "…" }
 *     → ResolveExceptionResult
 *   { "action": "mark_imported", "by": "Name", "batch"?: "ECOM-2609" } → PostingResult
 *     (exported close only; SIMULATED BC import; ok=false + posting status "failed" when validation fails)
 *   { "action": "mark_posted", "by": "Name" } → PostingResult (imported only; SIMULATED)
 * POST multipart/form-data: action=import_workbook, file=<CSV>, by?=Name
 *   → WorkbookImportResult (replaces the period's workbook baseline, re-reconciles)
 * Errors: 400 bad period/body, 404 no close yet, 409 wrong status, 500 otherwise.
 */
import { NextResponse } from "next/server";
import {
  approveClose,
  CloseError,
  generateClose,
  getCloseView,
  importWorkbookBaseline,
  markImported,
  markPosted,
  reconcileClose,
  resolveCloseException,
} from "@/close";
import { closeErrorResponse } from "@/close/http";
import { invalidateViews } from "@/lib/views/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ period: string }> };

const ACTIONS = '"generate", "reconcile", "approve", "resolve_exception", "import_workbook", "mark_imported" or "mark_posted"';
const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { period } = await params;
    return NextResponse.json(await getCloseView(period));
  } catch (err) {
    return closeErrorResponse(err);
  }
}

async function handlePOST(req: Request, { params }: Ctx) {
  try {
    const { period } = await params;

    if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
      const form = await req.formData();
      if (form.get("action") !== "import_workbook") {
        throw new CloseError("bad_input", 'multipart POST needs action=import_workbook and a "file" field');
      }
      const file = form.get("file");
      if (!file || typeof file === "string") throw new CloseError("bad_input", 'import_workbook needs a CSV in the "file" field');
      if (file.size > MAX_WORKBOOK_BYTES) throw new CloseError("bad_input", "Workbook CSV is larger than 5 MB");
      const by = typeof form.get("by") === "string" ? String(form.get("by")).trim() || undefined : undefined;
      const text = await file.text();
      return NextResponse.json(await importWorkbookBaseline(period, text, { fileName: file.name, by }));
    }

    let body: Record<string, unknown>;
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      throw new CloseError("bad_input", 'Expected a JSON body like {"action":"generate"}');
    }
    const force = body.force === true;
    const by = typeof body.by === "string" && body.by.trim() ? body.by.trim() : undefined;
    const needBy = (what: string) => {
      if (!by) throw new CloseError("bad_input", `${what} needs "by" (the person's name)`);
      return by;
    };
    switch (body.action) {
      case "generate":
        return NextResponse.json(await generateClose(period, { force, by }));
      case "reconcile":
        return NextResponse.json(await reconcileClose(period, { by }));
      case "approve":
        if (typeof body.approvedBy !== "string" || !body.approvedBy.trim()) {
          throw new CloseError("bad_input", "approve needs approvedBy (the approver's name)");
        }
        return NextResponse.json(await approveClose(period, body.approvedBy, { force }));
      case "resolve_exception": {
        if (typeof body.exceptionId !== "string") throw new CloseError("bad_input", "resolve_exception needs exceptionId");
        if (body.status !== "resolved" && body.status !== "waived") throw new CloseError("bad_input", 'status must be "resolved" or "waived"');
        return NextResponse.json(
          await resolveCloseException(period, body.exceptionId, {
            status: body.status,
            by: needBy("resolve_exception"),
            note: typeof body.note === "string" ? body.note : undefined,
          }),
        );
      }
      case "mark_imported":
        return NextResponse.json(
          await markImported(period, { by: needBy("mark_imported"), batch: typeof body.batch === "string" ? body.batch : undefined }),
        );
      case "mark_posted":
        return NextResponse.json(await markPosted(period, { by: needBy("mark_posted") }));
      case "import_workbook":
        throw new CloseError("bad_input", "import_workbook is a multipart/form-data POST with a CSV in the \"file\" field");
      default:
        throw new CloseError("bad_input", `action must be ${ACTIONS}`);
    }
  } catch (err) {
    return closeErrorResponse(err);
  }
}

/** Writes to the database, so cached view results are dropped afterwards. */
export async function POST(...args: Parameters<typeof handlePOST>) {
  try {
    return await handlePOST(...args);
  } finally {
    invalidateViews();
  }
}
