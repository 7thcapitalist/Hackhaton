/**
 * GET /api/close/YYYY-MM/export?format=xlsx|csv (default xlsx)
 * → file download (Content-Disposition: attachment). Only for an approved
 * (or already exported) close; marks it exported. 409 otherwise.
 */
import { NextResponse } from "next/server";
import { CloseError, EXPORT_CONTENT_TYPES, exportClose, exportFileName, type ExportFormat } from "@/close";
import { closeErrorResponse } from "@/close/http";
import { invalidateViews } from "@/lib/views/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request, { params }: { params: Promise<{ period: string }> }) {
  try {
    const { period } = await params;
    const format = (new URL(req.url).searchParams.get("format") || "xlsx").toLowerCase() as ExportFormat;
    if (format !== "xlsx" && format !== "csv") {
      throw new CloseError("bad_input", `format must be xlsx or csv, got "${format}"`);
    }
    const buffer = await exportClose(period, format);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${exportFileName(period, format)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return closeErrorResponse(err, "api/close/export");
  }
}

/** Writes to the database, so cached view results are dropped afterwards. */
export async function GET(...args: Parameters<typeof handleGET>) {
  try {
    return await handleGET(...args);
  } finally {
    invalidateViews();
  }
}
