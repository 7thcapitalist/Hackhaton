/**
 * GET  /api/close/YYYY-MM → CloseView (works before a close exists).
 * POST /api/close/YYYY-MM  JSON body:
 *   { "action": "generate", "force"?: boolean }   → GenerateResult (force = rebuild an exported close)
 *   { "action": "reconcile" }                     → ReconcileResult
 *   { "action": "approve", "approvedBy": "Name", "force"?: boolean } → ApproveResult
 *     (force approves despite open exceptions and marks each one waived)
 * Errors: 400 bad period/body, 404 no close yet, 409 wrong status, 500 otherwise.
 */
import { NextResponse } from "next/server";
import { approveClose, CloseError, generateClose, getCloseView, reconcileClose } from "@/close";
import { closeErrorResponse } from "@/close/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ period: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { period } = await params;
    return NextResponse.json(await getCloseView(period));
  } catch (err) {
    return closeErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { period } = await params;
    let body: { action?: unknown; approvedBy?: unknown; force?: unknown };
    try {
      body = (await req.json()) ?? {};
    } catch {
      throw new CloseError("bad_input", 'Expected a JSON body like {"action":"generate"}');
    }
    const force = body.force === true;
    switch (body.action) {
      case "generate":
        return NextResponse.json(await generateClose(period, { force }));
      case "reconcile":
        return NextResponse.json(await reconcileClose(period));
      case "approve":
        if (typeof body.approvedBy !== "string" || !body.approvedBy.trim()) {
          throw new CloseError("bad_input", "approve needs approvedBy (the approver's name)");
        }
        return NextResponse.json(await approveClose(period, body.approvedBy, { force }));
      default:
        throw new CloseError("bad_input", 'action must be "generate", "reconcile" or "approve"');
    }
  } catch (err) {
    return closeErrorResponse(err);
  }
}
