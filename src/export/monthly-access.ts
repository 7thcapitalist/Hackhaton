import { createHash, timingSafeEqual } from "node:crypto";
import { ReportError } from "./validation";

/** Interim server integration gate. Do not put the secret in a browser or URL. */
export function requireMonthlyDetailAccess(request: Request, env: Record<string, string | undefined> = process.env): void {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) throw new ReportError(503, "monthly_access_not_configured", "Detailed monthly exports require authorized server access. Employee authentication must be integrated before a public download button is enabled.");
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash(`Bearer ${secret}`))) throw new ReportError(401, "unauthorized", "Authorized server access is required for detailed monthly exports.");
}
