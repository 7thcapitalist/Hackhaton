/**
 * Reconciliation check for the cost views (src/lib/views/costs.ts):
 *  - getCostBreakdown(period).contributionPct === scorecard net_margin_pct
 *  - P&L identity: gross + shipping charged − refunds − fees = net revenue
 *  - getCostedMargin totals (by category and by channel) === breakdown contribution,
 *    and each total cost bucket matches the breakdown
 *  - per-channel breakdowns sum to the all-channel contribution
 * Prints the cost table. Run: npm run check:costs [-- 2026-09]
 * Uses TURSO_DATABASE_URL (default file:local.db) from .env.local / .env.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const $ = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const { getCostBreakdown, getCostedMargin, getScorecard } = await import("../src/lib/views");
  const period = process.argv[2] ?? "2026-09";
  const problems: string[] = [];
  const expect = (ok: boolean, msg: string) => {
    if (!ok) problems.push(msg);
  };

  const b = await getCostBreakdown({ period });
  const r = b.revenue;
  console.log(`Cost breakdown ${period} (all channels)`);
  const rows: [string, number][] = [
    ["Gross sales", r.grossSalesCents],
    ["+ Shipping charged to buyers", r.shippingChargedCents],
    ["- Refunds / cancellations", -r.refundsCents],
    ["- Marketplace fees (per order)", -r.marketplaceFeesCents],
    ["= Net revenue", r.netRevenueCents],
    ["- Shipping labels (net of carrier refunds)", -b.shippingLabels.costCents],
    ...b.shippingLabels.byCarrier.map((c) => [`    ${c.label}`, -c.cents] as [string, number]),
    ["- Other marketplace / shipping-account charges", -b.otherCharges.costCents],
    ...b.otherCharges.lines.map((c) => [`    ${c.label}`, -c.cents] as [string, number]),
    [`- Processing labor (${b.labor.hours} h × ${$(b.labor.rateCentsPerHour)}/h, simulated)`, -b.labor.costCents],
    ["= Contribution", b.contributionCents],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(60)} ${$(v).padStart(14)}`);
  console.log(`  ${"Contribution %".padEnd(60)} ${String(b.contributionPct).padStart(13)}%`);
  console.log(`  Excluded: tax collected ${$(b.excluded.taxCollectedCents)}`);
  for (const e of b.excluded.lines) console.log(`    ${e.label.padEnd(44)} ${$(e.cents).padStart(14)}  ${e.reason}`);
  if (b.missing.length) console.log(`  Missing: ${b.missing.join(" ")}`);

  expect(
    r.grossSalesCents + r.shippingChargedCents - r.refundsCents - r.marketplaceFeesCents === r.netRevenueCents,
    "P&L identity broken: gross + shipping − refunds − fees ≠ net revenue",
  );
  expect(
    b.shippingLabels.byCarrier.reduce((s, c) => s + c.cents, 0) === b.shippingLabels.costCents,
    "byCarrier does not sum to shipping label cost",
  );

  const sc = await getScorecard(period);
  const nm = sc.kpis.find((k) => k.id === "net_margin_pct")?.value ?? null;
  console.log(`\nScorecard net_margin_pct ${nm}% vs breakdown contribution ${b.contributionPct}%`);
  if (b.missing.length === 0) expect(nm === b.contributionPct, `net_margin_pct ${nm} ≠ contribution % ${b.contributionPct}`);

  for (const by of ["category", "channel"] as const) {
    const m = await getCostedMargin({ period, by });
    console.log(`\nCosted margin by ${by} (${period})`);
    console.log(`  ${"group".padEnd(16)} ${"net rev".padStart(12)} ${"ship link".padStart(10)} ${"ship alloc".padStart(11)} ${"labor".padStart(11)} ${"other".padStart(9)} ${"contrib".padStart(12)} ${"%".padStart(6)}`);
    for (const g of [...m.groups, m.totals]) {
      console.log(
        `  ${g.group.padEnd(16)} ${$(g.netRevenueCents).padStart(12)} ${$(g.shippingLinkedCents).padStart(10)} ${$(g.shippingAllocatedCents).padStart(11)} ${$(g.laborAllocatedCents).padStart(11)} ${$(g.otherChargesCents).padStart(9)} ${$(g.contributionCents).padStart(12)} ${String(g.contributionPct).padStart(6)}`,
      );
    }
    const t = m.totals;
    expect(t.contributionCents === b.contributionCents, `${by}: total contribution ${t.contributionCents} ≠ breakdown ${b.contributionCents}`);
    expect(t.netRevenueCents === r.netRevenueCents, `${by}: net revenue mismatch`);
    expect(t.shippingCostCents === b.shippingLabels.costCents, `${by}: shipping mismatch`);
    expect(t.laborAllocatedCents === b.labor.costCents, `${by}: labor mismatch`);
    expect(t.otherChargesCents === b.otherCharges.costCents, `${by}: other charges mismatch`);
    expect(t.contributionPct === b.contributionPct, `${by}: contribution % mismatch`);
  }

  let sumCh = 0;
  for (const ch of ["shopgoodwill", "amazon", "ebay", "goodwill_books", "other"] as const) {
    sumCh += (await getCostBreakdown({ period, channel: ch })).contributionCents;
  }
  expect(sumCh === b.contributionCents, `per-channel breakdowns sum to ${sumCh} ≠ ${b.contributionCents}`);

  if (problems.length) {
    console.error(`\nFAIL (${problems.length}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nOK: cost breakdown, scorecard net margin and costed margins reconcile.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
