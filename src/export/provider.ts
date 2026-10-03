import { getPulse, getScorecard } from "@/lib/views";
import { parsePulse, parseScorecard, ReportError, validBusinessDate, validPeriod } from "./validation";

interface SharedViews {
  getPulse(date: string): Promise<unknown>;
  getScorecard(period: string): Promise<unknown>;
}
async function readView(read: () => Promise<unknown>): Promise<unknown> {
  try { return await read(); } catch {
    throw new ReportError(503, "view_unavailable", "Shared report data is unavailable. Check the database configuration and data setup.");
  }
}
// Production uses Joao's functions directly. Tests inject readers without a DB.
export function createReportProvider(views: SharedViews) {
  return {
    async loadPulse(date: string) {
      if (!validBusinessDate(date)) throw new ReportError(400, "invalid_date", "Use a real date in YYYY-MM-DD format.");
      return parsePulse(await readView(() => views.getPulse(date)), date);
    },
    async loadScorecard(period: string) {
      if (!validPeriod(period)) throw new ReportError(400, "invalid_period", "Use YYYY-MM format.");
      return parseScorecard(await readView(() => views.getScorecard(period)), period);
    },
  };
}
export const reportProvider = createReportProvider({ getPulse, getScorecard });
