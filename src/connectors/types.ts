/**
 * Connector contract: how one source's data gets from the platform into a
 * file that the existing ingest path (src/ingest) understands.
 *
 * Every connector returns FILES (bytes + a file name). Report-style APIs
 * (Amazon SP-API Reports, EasyPost Reports) return the same flat files the
 * portals export, so the existing CSV parsers read them. JSON APIs (eBay REST,
 * EasyPost Shipments) are saved as one .json file per response page and read
 * by the JSON parsers (src/sources/ebay_api.ts, easypost_api.ts). Sources with
 * no API (email / manual) read a drop folder. So the same ingest code runs
 * whether the bytes came from a mock, a real API or a human upload.
 */

export type ConnectorMode = "api_report" | "api_json" | "email" | "manual";

/** Inclusive range of business dates (YYYY-MM-DD, America/Indiana/Indianapolis). */
export interface PullRange {
  from: string;
  to: string;
}

export interface PullRequest extends PullRange {
  /**
   * true = deterministic mock responses in the exact real API shape (no
   * credentials needed). false/undefined = the real API (needs credentials;
   * email/manual connectors read their drop folder).
   */
  mock?: boolean;
}

export interface PulledFile {
  fileName: string;
  bytes: Buffer;
}

export interface Connector {
  sourceId: string;
  /** Human label for status pages. */
  label: string;
  mode: ConnectorMode;
  /** One line on how the real data arrives. */
  describe: string;
  /** Env var NAMES the real implementation reads, required and optional (never values). */
  envVars: string[];
  /** The subset of envVars the real path cannot run without. */
  requiredEnvVars: string[];
  /** True when every required env var for the real path is set. */
  hasCredentials(): boolean;
  pull(req: PullRequest): Promise<PulledFile[]>;
}

export class ConnectorError extends Error {
  constructor(
    public readonly sourceId: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
