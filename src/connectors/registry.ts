/**
 * Connector registry: one connector per source in src/ingest/config.ts.
 * See ./types.ts for the contract and ./run.ts for pull → ingest.
 */
import { amazonConnector } from "./amazon";
import {
  cashmonkeyConnector,
  fedexConnector,
  goodwillBooksConnector,
  jewelryConnector,
  shopgoodwillConnector,
  uprightConnector,
} from "./dropfolder";
import { easypostConnector } from "./easypost";
import { ebayConnector } from "./ebay";
import type { Connector } from "./types";

export const connectors: Connector[] = [
  amazonConnector,
  ebayConnector,
  easypostConnector,
  uprightConnector,
  shopgoodwillConnector,
  goodwillBooksConnector,
  fedexConnector,
  cashmonkeyConnector,
  jewelryConnector,
];

export function getConnector(sourceId: string): Connector | undefined {
  return connectors.find((c) => c.sourceId === sourceId);
}
