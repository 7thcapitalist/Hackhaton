/**
 * Connectors: pull each source's data (mock or real API / drop folder) and
 * ingest it through the same path as uploads.
 *
 *   pullAndIngest({ from, to, mock?, sourceIds? })   ./run.ts
 *   getConnectorStatus()                             ./status.ts
 *   connectors / getConnector(sourceId)              ./registry.ts
 */
export { connectors, getConnector } from "./registry";
export { pullAndIngest } from "./run";
export type { PullAndIngestOptions, PullSummary, ConnectorPullResult, PulledFileResult } from "./run";
export { getConnectorStatus } from "./status";
export type { ConnectorStatus } from "./status";
export type { Connector, ConnectorMode, PulledFile, PullRange, PullRequest } from "./types";
export { ConnectorError } from "./types";
