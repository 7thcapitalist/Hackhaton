/**
 * Connectors for the ops sources (no revenue): item lifecycle, labor,
 * marketplace ratings and the 1st Source bank statement.
 *
 *  - production_tracking  (email)  scheduled export from Goodwill's production-tracking system
 *  - upright_inventory    (email)  Upright Lister inventory/products export, scheduled by email
 *  - bank_1st_source      (manual) CSV download from 1st Source online banking, acct 0101
 *  - timekeeping          (api_report once PAYROLL_API_* is set, else manual)
 *      Paylocity / ADP expose timecard reports through their APIs (OAuth client
 *      credentials). The real call is not wired yet: with credentials set the
 *      pull fails loudly instead of inventing data; without them the drop folder
 *      data/inbox/timekeeping/ is read (HR exports the timecard CSV).
 *  - marketplace_ratings  (api_report once MARKETPLACE_RATINGS_API_* is set, else manual)
 *      eBay Analytics API (getSellerStandardsProfile, traffic report) and Amazon
 *      SP-API (Account Health) could feed it; until wired, a monthly CSV copied
 *      from the seller dashboards goes into data/inbox/marketplace_ratings/.
 *
 * Mock path (all five): the monthly export files from the fixture set
 * (data/fixtures/<source_id>/ or the seed's in-memory set), i.e. exactly what
 * the API report / email / portal would hand over.
 */
import { dropFolderConnector } from "./dropfolder";
import { fixtureFiles } from "./fixtures";
import { ConnectorError, type Connector } from "./types";
import { assertRange, hasEnv, readLocal } from "./util";

export const productionTrackingConnector = dropFolderConnector({
  sourceId: "production_tracking",
  label: "Production tracking (item pipeline)",
  mode: "email",
  describe: "Scheduled production-tracking export (donated / identified / sent to e-com) by email → inbox/production_tracking/.",
});

export const uprightInventoryConnector = dropFolderConnector({
  sourceId: "upright_inventory",
  label: "Upright Lister inventory (listed / sold)",
  mode: "email",
  describe: "Upright Lister inventory/products export (listed, sold, lister, relists) by email → inbox/upright_inventory/.",
});

export const bank1stSourceConnector = dropFolderConnector({
  sourceId: "bank_1st_source",
  label: "1st Source bank, acct 0101 (informational)",
  mode: "manual",
  describe: "1st Source online banking CSV for acct 0101 → inbox/bank_1st_source/ or upload. Not posted by the close yet.",
});

/** A report-style API that is not wired yet: mock = fixture files; real = drop folder until credentials exist. */
function reportApiConnector(opts: { sourceId: string; label: string; describe: string; envVars: string[] }): Connector {
  const drop = dropFolderConnector({ sourceId: opts.sourceId, label: opts.label, mode: "manual", describe: opts.describe });
  return {
    sourceId: opts.sourceId,
    label: opts.label,
    get mode() {
      return hasEnv(opts.envVars) ? "api_report" : "manual";
    },
    describe: opts.describe,
    envVars: opts.envVars,
    requiredEnvVars: opts.envVars,
    hasCredentials: () => hasEnv(opts.envVars) || drop.hasCredentials(),
    async pull(req) {
      assertRange(req);
      if (req.mock) return fixtureFiles(opts.sourceId, req).map((f) => readLocal(f, "pull_"));
      if (hasEnv(opts.envVars)) {
        throw new ConnectorError(opts.sourceId, "real API pull is not implemented yet; drop the export in the inbox folder instead");
      }
      return drop.pull(req);
    },
  };
}

export const timekeepingConnector = reportApiConnector({
  sourceId: "timekeeping",
  label: "Timekeeping (payroll timecards)",
  describe: "Payroll timecard report (REG/OT hours per employee id and day, e-commerce departments) → inbox/timekeeping/; API later.",
  envVars: ["PAYROLL_API_CLIENT_ID", "PAYROLL_API_CLIENT_SECRET"],
});

export const marketplaceRatingsConnector = reportApiConnector({
  sourceId: "marketplace_ratings",
  label: "Marketplace ratings (CSAT / NPS / conversion)",
  describe: "Monthly CSAT, NPS, conversion and seller rating per marketplace → inbox/marketplace_ratings/; APIs later.",
  envVars: ["MARKETPLACE_RATINGS_API_KEY"],
});
