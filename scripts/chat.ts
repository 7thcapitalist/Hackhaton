/**
 * Ask the data chat a question from the terminal.
 *
 *   npm run chat -- "Which day of the week do we sell most?"
 *   npm run chat -- --tools          # run every chat tool directly (no model, no API key)
 *
 * Prints the streamed answer, the tools used ("How I got this") and token usage.
 * Uses OPENAI_API_KEY (or OPEN_API_KEY) (+ optional OPENAI_MODEL) and TURSO_DATABASE_URL
 * (default file:local.db) from .env.local / .env.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function exerciseTools() {
  const { runTool } = await import("../src/ai/chat/tools");
  const { latestBusinessDate } = await import("../src/ai/chat/sql");
  const latest = (await latestBusinessDate()) ?? "2026-10-02";
  const period = latest.slice(0, 7);
  const from = `${period}-01`;
  const cases: [string, Record<string, unknown> | string][] = [
    ["get_pulse", { date: latest }],
    ["get_pulse_series", { from, to: latest }],
    ["get_scorecard", { period }],
    ["get_source_status", { period }],
    ["get_exceptions", { status: "open", period }],
    ["get_orders", { date: latest, limit: 3 }],
    [
      "run_sql",
      {
        query:
          "SELECT strftime('%w', business_date) AS weekday, COUNT(*) AS lines, SUM(net_cents) AS net_cents FROM orders WHERE status != 'cancelled' GROUP BY 1 ORDER BY net_cents DESC",
        purpose: "Revenue by weekday",
      },
    ],
    ["run_sql", { query: "DELETE FROM orders", purpose: "should be rejected" }],
    ["get_pulse", { date: "yesterday" }],
    ["get_pulse", "{not json"],
  ];
  console.log(`Latest business date: ${latest}\n`);
  for (const [name, args] of cases) {
    const raw = typeof args === "string" ? args : JSON.stringify(args);
    const out = await runTool(name, raw);
    let preview = JSON.stringify(out.result);
    if (preview.length > 600) preview = `${preview.slice(0, 600)}… (${preview.length} chars)`;
    console.log(`## ${name} ${raw}`);
    console.log(`   isError=${Boolean(out.isError)} rowCount=${out.rowCount ?? "-"}${out.sql ? ` sql=${JSON.stringify(out.sql)}` : ""}`);
    console.log(`   ${preview}\n`);
  }
}

async function ask(question: string) {
  const { chatConfigured, runChat } = await import("../src/ai/chat/agent");
  if (!chatConfigured()) {
    console.error("OPENAI_API_KEY (or OPEN_API_KEY) is not set. Put it in .env.local (or run `npm run chat -- --tools`).");
    process.exit(1);
  }
  let trace: unknown[] = [];
  const started = Date.now();
  const usage = await runChat({
    messages: [{ role: "user", content: question }],
    emit: (e) => {
      if (e.type === "text") process.stdout.write(e.delta);
      else if (e.type === "tool") process.stdout.write(`\n  [tool] ${e.label}\n`);
      else if (e.type === "error") process.stdout.write(`\n  [error] ${e.message}\n`);
      else if (e.type === "trace") trace = e.items;
    },
  });
  console.log("\n\n--- How I got this ---");
  for (const t of trace as { tool: string; input: unknown; sql?: string; rowCount?: number }[]) {
    console.log(`- ${t.tool} ${JSON.stringify(t.input)}${t.rowCount !== undefined ? ` -> ${t.rowCount} rows` : ""}`);
    if (t.sql) console.log(`    SQL: ${t.sql.replace(/\s+/g, " ")}`);
  }
  console.log(
    `\n--- Usage (${usage.model}, ${usage.requests} requests, ${((Date.now() - started) / 1000).toFixed(1)} s) ---\n` +
      `input ${usage.inputTokens} (cached ${usage.cachedInputTokens}), output ${usage.outputTokens} (reasoning ${usage.reasoningTokens})` +
      `, est. cost ${usage.estimatedCostUsd === null ? "n/a" : `$${usage.estimatedCostUsd.toFixed(4)}`}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--tools")) return exerciseTools();
  const question = args.join(" ").trim();
  if (!question) {
    console.error('Usage: npm run chat -- "your question"   |   npm run chat -- --tools');
    process.exit(1);
  }
  await ask(question);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
