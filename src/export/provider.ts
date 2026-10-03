import { parsePulse, parseScorecard, ReportError } from "./validation";

type Env = Record<string, string | undefined>;

// Temporary boundary until the shared functions exist on main. Only the trusted
// deployment origin is used; request Host headers cannot select a fetch target.
export function reportOrigin(env: Env = process.env): string {
  const candidate = env.REPORTS_VIEW_ORIGIN || (env.VERCEL_URL ? "https://" + env.VERCEL_URL :
    env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined);
  if (!candidate) throw new ReportError(503, "reports_not_configured", "Configure the report view origin.");
  let url: URL;
  try { url = new URL(candidate); } catch {
    throw new ReportError(503, "reports_not_configured", "Invalid report view origin.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new ReportError(503, "reports_not_configured", "Use a trusted HTTPS origin or localhost.");
  }
  return url.origin;
}

async function readView(path: string, query: string, options: { env?: Env; fetch?: typeof fetch } = {}) {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(reportOrigin(options.env) + path + query,
      { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError(503, "view_unavailable", "The shared report view is unavailable.");
  }
  if (!response.ok) throw new ReportError(503, "view_unavailable",
    "The shared report view is not ready. No report was generated.");
  try { return await response.json() as unknown; } catch {
    throw new ReportError(502, "invalid_view_data", "The shared report view did not return JSON.");
  }
}

export async function loadPulse(date: string, options?: { env?: Env; fetch?: typeof fetch }) {
  return parsePulse(await readView("/api/views/pulse", "?date=" + encodeURIComponent(date), options), date);
}

export async function loadScorecard(period: string, options?: { env?: Env; fetch?: typeof fetch }) {
  return parseScorecard(await readView("/api/views/scorecard", "?period=" + encodeURIComponent(period), options), period);
}
