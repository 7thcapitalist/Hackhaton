import { ReportError } from "./validation";

export function reportFailure(error: unknown): Response {
  const known = error instanceof ReportError;
  return Response.json({ error: known ? error.code : "report_failed",
    message: known ? error.message : "The report could not be generated." },
    { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

export function download(body: string | Uint8Array, fileName: string, contentType: string,
  metadata: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...metadata },
  });
}
