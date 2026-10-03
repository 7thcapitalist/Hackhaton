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
} from "./dropfolder";
import { easypostConnector } from "./easypost";
import { ebayConnector } from "./ebay";
import { uprightConnector } from "./upright";
import {
  bank1stSourceConnector,
  marketplaceRatingsConnector,
  productionTrackingConnector,
  timekeepingConnector,
  uprightInventoryConnector,
} from "./ops";
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
  // Ops sources (no revenue).
  productionTrackingConnector,
  uprightInventoryConnector,
  timekeepingConnector,
  marketplaceRatingsConnector,
  bank1stSourceConnector,
];

export function getConnector(sourceId: string): Connector | undefined {
  return connectors.find((c) => c.sourceId === sourceId);
}
