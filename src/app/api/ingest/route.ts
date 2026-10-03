/**
 * POST /api/ingest — multipart/form-data upload.
 *
 * Fields: `file` (one or more), optional `sourceId`, optional `period` (YYYY-MM).
 * One file → IngestSummary JSON. Several files → array of results, where a
 * file that could not be ingested appears as { fileName, status: "error", code, error }.
 * Errors (single file): 400 bad input / unsupported file, 422 unrecognized file,
 * 413 too large, 500 unexpected.
 */
import { NextResponse } from "next/server";
import { redactSecrets } from "@/db/env";
import { IngestError, ingestFile, type IngestSummary } from "@/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel functions cap request bodies at ~4.5 MB

type FileError = { fileName: string; status: "error"; code: string; error: string; details?: unknown };

function errorOf(fileName: string, err: unknown): { body: FileError; httpStatus: number } {
  if (err instanceof IngestError) {
    return {
      body: { fileName, status: "error", code: err.code, error: err.message, details: err.details },
      httpStatus: err.httpStatus,
    };
  }
  const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const message = redactSecrets(root instanceof Error ? root.message : String(root));
  console.error("[api/ingest]", message);
  return { body: { fileName, status: "error", code: "internal", error: message }, httpStatus: 500 };
}

const bad = (error: string, status = 400) => NextResponse.json({ status: "error", code: "bad_input", error }, { status });

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 64 * 1024) return bad(`Upload is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Expected multipart/form-data with a `file` field");
  }
  const files = [...form.getAll("file"), ...form.getAll("files")].filter(
    (f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f,
  );
  if (files.length === 0) return bad("No file uploaded (field name: `file`)");
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES) return bad(`Upload is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413);

  const sourceId = (form.get("sourceId") as string | null)?.trim() || undefined;
  const period = (form.get("period") as string | null)?.trim() || undefined;
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return bad(`period must be YYYY-MM, got "${period}"`);

  const results: (IngestSummary | FileError)[] = [];
  let firstStatus = 200;
  for (const file of files) {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      results.push(await ingestFile({ buffer, fileName: file.name || "upload.csv", sourceId, period }));
    } catch (err) {
      const { body, httpStatus } = errorOf(file.name, err);
      results.push(body);
      if (firstStatus === 200) firstStatus = httpStatus;
    }
  }

  if (files.length === 1) return NextResponse.json(results[0], { status: firstStatus });
  return NextResponse.json(results, { status: 200 });
}
