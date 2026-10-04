/**
 * GET /api/close/YYYY-MM/evidence[?by=Name] → reconciliation evidence XLSX
 * (attachment): Summary, Source package, Tie-out, Journal, AR Invoice,
 * Exceptions, Rules applied, Audit trail. Any generated close; 404 before.
 */
import { NextResponse } from "next/server";
import { EVIDENCE_CONTENT_TYPE, evidenceFileName, exportEvidence } from "@/close";
import { closeErrorResponse } from "@/close/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ period: string }> }) {
  try {
    const { period } = await params;
    const by = new URL(req.url).searchParams.get("by")?.trim().slice(0, 80) || undefined;
    const buffer = await exportEvidence(period, { by });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": EVIDENCE_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${evidenceFileName(period)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return closeErrorResponse(err, "api/close/evidence");
  }
}
