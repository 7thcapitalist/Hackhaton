/**
 * The messy cases, as files to upload LIVE on stage (data/demo-uploads/).
 * They are NOT part of the seeded baseline (which is clean: zero open
 * exceptions). `npm run mock:generate` writes them next to the fixtures;
 * `npm run demo:reset` undoes whatever they did. See data/demo-uploads/README.md.
 */
import { localToUtc } from "../../src/lib/views/dates";
import { buildFixtures } from "./fixtures";
import { buildModel, type AmazonEvent, type MockModel } from "./model";
import { DONE_DATES } from "./schedule";
import { amazonEventsFile } from "./writers/amazon";
import { ebayRenamedFile } from "./writers/ebay";
import { jewelryNoSupplierFile } from "./writers/jewelry";
import { uprightFileOf } from "./writers/upright";

export const DEMO_DATE = "2026-10-02";

export interface DemoUpload {
  name: string;
  content: string;
}

export function buildDemoUploads(model: MockModel = buildModel()): DemoUpload[] {
  const fixtures = buildFixtures(model);
  const ebay = fixtures.find((f) => f.path === `ebay/ebay_${DEMO_DATE}.csv`);
  if (!ebay) throw new Error(`no eBay fixture for ${DEMO_DATE}`);

  // 02: one Amazon row of a transaction type the parser does not know.
  const liquidation = {
    ts: localToUtc(DEMO_DATE, 17 * 3600 + 45 * 60),
    businessDate: DEMO_DATE,
    type: "Liquidations",
    description: "Liquidation proceeds",
    amountCents: 310,
  } as unknown as AmazonEvent;

  // 03: eBay / ShopGoodwill orders of the day that Upright did NOT list in the baseline.
  const overlap = model.orders
    .filter((o) => o.businessDate === DEMO_DATE && (o.stream === "ebay" || o.stream === "shopgoodwill") && !o.inUpright && o.status === "paid")
    .slice(0, 6)
    .map((o, i) => ({ ...o, inUpright: true, uprightOrderId: `UP-DEMO-${String(i + 1).padStart(3, "0")}` }));

  // 05: the latest finished day whose jewelry report has a row with a Supplier.
  let jewelry: string | null = null;
  for (const d of [...DONE_DATES].reverse()) {
    try {
      jewelry = jewelryNoSupplierFile(model, d);
      break;
    } catch {
      // no jewelry row that day
    }
  }
  if (!jewelry) throw new Error("no jewelry row to blank");

  return [
    { name: `01_ebay_${DEMO_DATE}_reupload.csv`, content: ebay.content },
    { name: `02_amazon_${DEMO_DATE}_unknown_type.csv`, content: amazonEventsFile([liquidation]) },
    { name: `03_upright_${DEMO_DATE}_overlap.csv`, content: uprightFileOf(overlap) },
    { name: "04_ebay_renamed_columns.csv", content: ebayRenamedFile(model, DEMO_DATE) },
    { name: "05_jewelry_no_supplier.csv", content: jewelry },
  ];
}
