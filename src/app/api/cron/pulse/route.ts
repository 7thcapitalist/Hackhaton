import { handlePulseCronRequest } from "@/emails/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  return handlePulseCronRequest(request);
}
