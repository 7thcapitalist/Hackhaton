/**
 * GET /api/connectors → per source: mode (api_report / api_json / email /
 * manual), whether the real path is configured (env var names + set/unset,
 * never values), last pull and last ingest. See src/connectors/status.ts.
 */
import { NextResponse } from "next/server";
import { redactSecrets } from "@/db/env";
import { getConnectorStatus } from "@/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ connectors: await getConnectorStatus() });
  } catch (err) {
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = redactSecrets(root instanceof Error ? root.message : String(root));
    console.error("[api/connectors]", message);
    return NextResponse.json({ status: "error", code: "internal", error: message }, { status: 500 });
  }
}
