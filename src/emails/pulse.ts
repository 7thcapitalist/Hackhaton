import { createHash, timingSafeEqual } from "node:crypto";
import { GOODWILL_TIMEZONE, isBusinessDate, previousBusinessDate } from "./dates";

export const MAX_PULSE_ATTACHMENT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

type Environment = Record<string, string | undefined>;
type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
type ReportStatus = "complete" | "partial" | "unknown";

interface ReportMetadata {
  synthetic: boolean | null;
  reportStatus: ReportStatus;
}

interface Dependencies {
  env?: Environment;
  fetch?: Fetch;
  now?: Date;
  timeoutMs?: number;
}

class PulseEmailError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function fail(status: number, code: string, message: string): never {
  throw new PulseEmailError(status, code, message);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function authenticate(request: Request, env: Environment): void {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) fail(503, "cron_not_configured", "CRON_SECRET must be configured.");
  // Hash both inputs to a fixed length before the constant-time comparison.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    fail(401, "unauthorized", "A valid cron bearer token is required.");
  }
}

function getReportOrigin(env: Environment): URL {
  const configured = env.REPORTS_VIEW_ORIGIN?.trim();
  const vercelHost = env.VERCEL_URL?.trim();
  const production = env.NODE_ENV === "production" || env.VERCEL === "1";
  const value = configured || (vercelHost ? `https://${vercelHost}` : production ? "" : "http://localhost:3000");
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    fail(503, "report_origin_not_configured", "Configure a trusted REPORTS_VIEW_ORIGIN.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && local && !production))
  ) {
    fail(503, "invalid_report_origin", "REPORTS_VIEW_ORIGIN must be an HTTPS origin (HTTP localhost in development only).");
  }
  return origin;
}

function getMailConfiguration(env: Environment) {
  const from = env.PULSE_FROM_EMAIL?.trim();
  const to = env.PULSE_TO_EMAIL?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!from || !to || !apiKey) {
    fail(503, "email_not_configured", "Configure PULSE_FROM_EMAIL, PULSE_TO_EMAIL and RESEND_API_KEY.");
  }
  const email = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
  const senderAddress = from.match(/^[^<>]*<([^<>]+)>$/)?.[1] ?? from;
  if (!email.test(to) || !email.test(senderAddress) || /[\r\n]/.test(from + to + apiKey)) {
    fail(503, "invalid_email_configuration", "Configure one valid recipient and a valid sender; header values must not contain line breaks.");
  }
  return { from, to, apiKey };
}

async function readBounded(response: Response, maximum: number, code: string): Promise<Buffer> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel();
    fail(502, code, "The response exceeds the allowed size.");
  }
  if (!response.body) fail(502, code, "The response body is empty.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        fail(502, code, "The response exceeds the allowed size.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) fail(502, code, "The response body is empty.");
  return Buffer.concat(chunks, size);
}

async function timedRequest<T>(
  url: string | URL,
  init: RequestInit,
  fetcher: Fetch,
  timeoutMs: number,
  stage: "export" | "resend",
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      ...init, signal: controller.signal, redirect: "error", cache: "no-store",
    });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) {
      fail(504, `${stage}_timeout`, "The request timed out; delivery is not confirmed. Retry with the same report.");
    }
    if (error instanceof PulseEmailError) throw error;
    fail(stage === "export" ? 503 : 502, `${stage}_unavailable`,
      stage === "export" ? "The CSV export is unavailable. The pulse-export dependency must be deployed first." : "Resend is unavailable; delivery is not confirmed.");
  } finally {
    clearTimeout(timeout);
  }
}

function metadata(response: Response): ReportMetadata {
  const synthetic = response.headers.get("x-report-synthetic");
  const status = response.headers.get("x-report-status");
  return {
    synthetic: synthetic === "true" ? true : synthetic === "false" ? false : null,
    reportStatus: status === "complete" || status === "partial" ? status : "unknown",
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function makePayload(date: string, dashboard: URL, csv: Buffer, report: ReportMetadata, mail: { from: string; to: string }) {
  const synthetic = report.synthetic === true
    ? "Synthetic demonstration data."
    : report.synthetic === false
      ? "The export is not marked synthetic."
      : "Data origin is unknown: the export did not provide valid synthetic-data metadata.";
  const completeness = report.reportStatus === "complete"
    ? "Report coverage: complete, according to the export metadata."
    : report.reportStatus === "partial"
      ? "Report coverage: partial. Some channels or metrics are unavailable; missing values are not zero."
      : "Report coverage: unknown. Completeness has not been confirmed.";
  const dashboardUrl = dashboard.toString();
  const text = [
    `Mission Control daily pulse — ${date}`,
    `Business timezone: ${GOODWILL_TIMEZONE}.`,
    synthetic,
    completeness,
    "The daily CSV is attached. Figures are provided by the shared pulse export; this email does not recalculate them.",
    `Dashboard: ${dashboardUrl}`,
  ].join("\n\n");
  return {
    from: mail.from,
    to: [mail.to],
    subject: `Mission Control daily pulse — ${date}${report.synthetic === true ? " [Synthetic]" : ""}${report.reportStatus === "partial" ? " [Partial]" : ""}`,
    text,
    html: `<h1>Daily pulse — ${date}</h1><p>Business timezone: ${GOODWILL_TIMEZONE}.</p><p>${escapeHtml(synthetic)}</p><p>${escapeHtml(completeness)}</p><p>The daily CSV is attached. Figures come from the shared pulse export.</p><p><a href="${escapeHtml(dashboardUrl)}">Open the dashboard</a></p>`,
    attachments: [{ filename: `pulse-${date}.csv`, content: csv.toString("base64") }],
  };
}

/** The injected fetch is used by tests; no mock report or direct database read exists here. */
export async function handlePulseCronRequest(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const fetcher = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS;
  try {
    authenticate(request, env);
    const query = new URL(request.url).searchParams;
    const suppliedDate = query.get("date");
    const date = suppliedDate ?? previousBusinessDate(dependencies.now ?? new Date());
    if (query.getAll("date").length > 1 || !isBusinessDate(date)) {
      fail(400, "invalid_date", "date must be a real calendar date in YYYY-MM-DD format.");
    }
    const dryRunValue = query.get("dryRun");
    if (query.getAll("dryRun").length > 1 || (dryRunValue !== null && !["true", "false"].includes(dryRunValue))) {
      fail(400, "invalid_dry_run", "dryRun must be true or false.");
    }
    const dryRun = dryRunValue === "true";
    if (!dryRun && env.PULSE_EMAIL_ENABLED !== "true") {
      fail(503, "email_disabled", "Email sending is disabled. Set PULSE_EMAIL_ENABLED=true to enable it, or use an authenticated dryRun=true request.");
    }
    const origin = getReportOrigin(env);
    const mail = dryRun ? null : getMailConfiguration(env);
    const exportUrl = new URL("/api/export/pulse", origin);
    exportUrl.searchParams.set("date", date);
    exportUrl.searchParams.set("format", "csv");
    const report = await timedRequest(exportUrl, { method: "GET", headers: { Accept: "text/csv" } }, fetcher, timeoutMs, "export", async (response) => {
      if (!response.ok) {
        fail(503, "export_unavailable", "The daily CSV export is not ready. Deploy the pulse-export dependency and its view API first.");
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (contentType !== "text/csv" && contentType !== "application/csv") {
        fail(502, "invalid_export", "The export endpoint did not return a CSV file.");
      }
      const csv = await readBounded(response, MAX_PULSE_ATTACHMENT_BYTES, "attachment_too_large_or_empty");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(csv);
      } catch {
        fail(502, "invalid_export", "The export endpoint did not return UTF-8 CSV.");
      }
      if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
        fail(502, "invalid_export", "The export endpoint returned an HTML page instead of CSV.");
      }
      return { csv, ...metadata(response) };
    });
    const dashboard = new URL("/pulse", origin);
    dashboard.searchParams.set("date", date);
    const summary = {
      businessDate: date,
      timezone: GOODWILL_TIMEZONE,
      synthetic: report.synthetic,
      reportStatus: report.reportStatus,
      attachment: { filename: `pulse-${date}.csv`, bytes: report.csv.byteLength },
      dashboardUrl: dashboard.toString(),
    };
    if (dryRun) return json({ status: "dry_run", ...summary, message: "CSV prepared; no email was sent." }, 200);
    const payload = makePayload(date, dashboard, report.csv, report, mail!);
    const body = JSON.stringify(payload);
    const key = `pulse/${date}/${createHash("sha256").update(body).digest("hex")}`;
    const id = await timedRequest(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${mail!.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body,
    }, fetcher, timeoutMs, "resend", async (response) => {
      if (!response.ok) fail(502, "resend_rejected", "Resend rejected the request; email delivery is not confirmed.");
      const result = await readBounded(response, 64 * 1024, "invalid_resend_response");
      let data: unknown;
      try { data = JSON.parse(result.toString("utf8")); } catch {
        fail(502, "invalid_resend_response", "Resend did not return a valid acknowledgement.");
      }
      if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string" || !data.id) {
        fail(502, "invalid_resend_response", "Resend did not return a message ID; delivery is not confirmed.");
      }
      return data.id;
    });
    return json({ status: "accepted", id, ...summary, message: "Resend accepted the request. Inbox delivery is not confirmed." }, 202);
  } catch (error) {
    if (error instanceof PulseEmailError) return json({ error: error.code, message: error.message }, error.status);
    // Never expose provider errors, request headers, credentials or recipient addresses.
    return json({ error: "pulse_email_failed", message: "The email request could not be prepared; delivery is not confirmed." }, 500);
  }
}
