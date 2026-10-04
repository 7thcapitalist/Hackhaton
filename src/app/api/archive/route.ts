/**
 * GET /api/archive?run=<ingest run id>   (or ?key=<archive key>)
 *
 * Downloads the ORIGINAL file of an ingest run from the raw-file archive
 * (src/archive): private Vercel Blob, data/archive/ (dev) or the versioned
 * seed fixture ("repo"). A key must belong to an ingest run, so only files the
 * pipeline archived can be fetched. 404 when the run, key or file is missing.
 *
 * Privacy: raw files may hold marketplace buyer ids that the DB only stores
 * hashed; the blob store is private and this route is the only way in.
 */
import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { readArchived, type ArchiveBackend } from "@/archive";
import { getDb } from "@/db/client";
import { redactSecrets } from "@/db/env";
import { ingestRuns } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = (error: string) => NextResponse.json({ status: "error", code: "not_found", error }, { status: 404 });

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const runId = p.get("run")?.trim();
  const key = p.get("key")?.trim();
  if (!runId && !key) {
    return NextResponse.json({ status: "error", code: "bad_input", error: "pass ?run=<ingest run id> or ?key=<archive key>" }, { status: 400 });
  }
  try {
    const db = getDb();
    const cols = { id: ingestRuns.id, fileName: ingestRuns.fileName, archiveKey: ingestRuns.archiveKey, archiveBackend: ingestRuns.archiveBackend };
    const [run] = runId
      ? await db.select(cols).from(ingestRuns).where(eq(ingestRuns.id, runId)).limit(1)
      : await db.select(cols).from(ingestRuns).where(eq(ingestRuns.archiveKey, key!)).orderBy(desc(ingestRuns.uploadedAt)).limit(1);
    if (!run) return notFound(runId ? `no ingest run ${runId}` : `no archived file with key ${key}`);
    if (!run.archiveKey || !run.archiveBackend || run.archiveBackend === "none") {
      return notFound(`"${run.fileName}" (run ${run.id}) was not archived`);
    }
    const file = await readArchived(run.archiveKey, run.archiveBackend as ArchiveBackend);
    if (!file) return notFound(`archived file ${run.archiveKey} (${run.archiveBackend}) is missing`);

    const headers = new Headers({
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Archive-Key": encodeURIComponent(run.archiveKey),
      "X-Archive-Backend": run.archiveBackend,
    });
    if (file.size != null) headers.set("Content-Length", String(file.size));
    const body = file.body instanceof Uint8Array ? Buffer.from(file.body) : file.body;
    return new NextResponse(body, { status: 200, headers });
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = redactSecrets(root instanceof Error ? root.message : String(root));
    console.error("[api/archive]", message);
    return NextResponse.json({ status: "error", code: "internal", error: message }, { status: 500 });
  }
}
