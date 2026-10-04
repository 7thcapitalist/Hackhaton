import { getPulse, getPulseSeries, getScorecard, getOrders, getSourceStatus, getIngestRuns } from "../lib/views";
import { collectProfileSnapshot, type ViewReader } from "./profile-source";
import { authorizeReport, demoAccess, reportProfiles, type Frequency } from "./profiles";
import { exportProfilePackage } from "../export/profile";
import { ReportError } from "../export/validation";

/** Read-only composition of Joao's views. No browser-supplied origin or role. */
export const profileViewReader: ViewReader = async (path, query) => {
  switch (path) {
    case "pulse": return getPulse(String(query.date));
    case "pulse-series": return getPulseSeries(String(query.from), String(query.to));
    case "scorecard": return getScorecard(String(query.period));
    case "orders": return getOrders({ ...(query.date ? { date: String(query.date) } : { period: String(query.period) }), limit: Number(query.limit), offset: Number(query.offset) });
    case "sources": return getSourceStatus(String(query.period));
    case "ingest-runs": return getIngestRuns({ period: String(query.period), limit: Number(query.limit), offset: Number(query.offset) });
    default: throw new Error("Unsupported report view");
  }
};

export function createProfileProvider(read: ViewReader, render = exportProfilePackage) {
  return async (frequency: Frequency, period: string) => {
    try {
      const plan = authorizeReport(reportProfiles.ceo, demoAccess.ceo, frequency, period);
      const snapshot = await collectProfileSnapshot(plan, read);
      // Public demonstration downloads must prove every exported record belongs
      // to a synthetic ingest file, not merely trust a demo label or query flag.
      const files = new Map(snapshot.files.map(file => [file.id, file]));
      if (!files.size || snapshot.files.some(file => !file.isSynthetic) || snapshot.orders.some(order => {
        const file = files.get(order.ingestRunId);
        return !file || !file.isSynthetic || file.sourceId !== order.sourceId;
      })) throw new ReportError(503, "demo_provenance_unavailable", "Report downloads require confirmed synthetic source files for every record.");
      return await render(snapshot);
    } catch (error) {
      if (error instanceof ReportError) throw error;
      throw new ReportError(503, "profile_report_unavailable", "The approved report could not be prepared from a stable synthetic dataset. Check the shared views and retry.");
    }
  };
}

export const profileProvider = { load: createProfileProvider(profileViewReader) };
