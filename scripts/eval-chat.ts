/**
 * Accuracy eval for the data chat (src/ai/chat). Asks the real model a fixed
 * set of questions and grades each final answer against ground truth computed
 * HERE, from the same database, with the view functions / SQL (never hardcoded).
 *
 *   TURSO_DATABASE_URL=file:eval.db npm run db:push && npm run seed -- --no-golden
 *   TURSO_DATABASE_URL=file:eval.db npm run eval:chat [-- --only 3,5] [--concurrency 3] [--verbose]
 *
 * Grading: numbers are extracted from the answer ($1,234.56 / 1.2k / 52.4% / 17).
 * Money passes within ±1% or ±$1 (whichever is larger), percents within ±0.2
 * points, counts exactly; ranking questions need the right name. Reasoning
 * questions need several facts (driver + amount + data completeness, ...).
 * Exits non-zero below 100%.
 *
 * Safety: refuses a non-file database unless --allow-remote (the eval must not
 * run against production). The OpenAI key is read from OPENAI_API_KEY or
 * OPEN_API_KEY: the environment first, then .env.local / .env here and in up to
 * three parent folders (ONLY the key and OPENAI_MODEL are taken from parents).
 */
import { config, parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function loadKeyFromParents() {
  if (process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY) return;
  let dir = resolve(".");
  for (let i = 0; i < 4; i++) {
    dir = dirname(dir);
    for (const f of [".env.local", ".env"]) {
      const p = join(dir, f);
      if (!existsSync(p)) continue;
      const vars = parse(readFileSync(p));
      for (const k of ["OPENAI_API_KEY", "OPEN_API_KEY", "OPENAI_MODEL"]) {
        if (vars[k] && !process.env[k]) process.env[k] = vars[k];
      }
      if (process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY) return;
    }
  }
}

// ---- Grading helpers ---------------------------------------------------------

/** Every number in the text: "$1,234.56", "1.2k", "$3.4M", "52.4%", "-7". */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(-|−)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?([kKmM](?![a-z]))?/g;
  for (const m of text.matchAll(re)) {
    let v = Number(`${m[2]!.replace(/,/g, "")}${m[3] ?? ""}`);
    if (m[4]) v *= m[4].toLowerCase() === "k" ? 1_000 : 1_000_000;
    out.push(v, m[1] ? -v : v);
  }
  return out;
}

const dollars = (cents: number) => cents / 100;
const fmt$ = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hasMoney = (text: string, cents: number) => {
  const want = Math.abs(dollars(cents));
  const tol = Math.max(1, want * 0.01);
  return extractNumbers(text).some((x) => Math.abs(Math.abs(x) - want) <= tol);
};
const hasPct = (text: string, p: number) => extractNumbers(text).some((x) => Math.abs(x - p) <= 0.2 + 1e-9);
const hasCount = (text: string, c: number) =>
  extractNumbers(text).some((x) => x === c) || (c === 0 && /\b(no|zero|none)\b/i.test(text));
const NAMES: Record<string, RegExp> = {
  shopgoodwill: /shop\s?goodwill/i,
  amazon: /amazon/i,
  ebay: /\bebay\b/i,
  goodwill_books: /goodwill\s?books|goodwillbooks/i,
  other: /\bother\b/i,
};
const hasName = (text: string, name: string) => (NAMES[name] ?? new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")).test(text);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Check {
  ok: boolean;
  expected: string;
}
interface Case {
  id: number;
  kind: "fact" | "reasoning";
  question: string;
  /** Computes ground truth, returns a grader of the answer. */
  truth: () => Promise<{ expected: string; grade: (answer: string) => Check[] }>;
}

const must = (ok: boolean, expected: string): Check => ({ ok, expected });

async function main() {
  loadKeyFromParents();
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dbUrl = process.env.TURSO_DATABASE_URL ?? "file:local.db";
  if (!dbUrl.startsWith("file:") && !args.includes("--allow-remote")) {
    console.error(`Refusing to run the eval against a non-file database (${dbUrl.split("?")[0]}). Use TURSO_DATABASE_URL=file:eval.db or --allow-remote.`);
    process.exit(2);
  }

  const views = await import("../src/lib/views");
  const { getClient } = await import("../src/db/client");
  const { chatConfigured, runChat } = await import("../src/ai/chat/agent");
  if (!chatConfigured()) {
    console.error("OPENAI_API_KEY (or OPEN_API_KEY) is not set.");
    process.exit(2);
  }
  const db = getClient();
  const scalar = async (q: string, a: (string | number)[] = []) => (await db.execute({ sql: q, args: a })).rows[0]?.[0];
  const kpi = async (period: string, id: string) => (await views.getScorecard(period)).kpis.find((k) => k.id === id)!;

  const P = "2026-09";
  const cases: Case[] = [
    {
      id: 1, kind: "fact", question: "What was our net revenue on 2026-10-01?",
      truth: async () => {
        const c = (await views.getPulse("2026-10-01")).totals.revenueCents;
        return { expected: fmt$(c), grade: (a) => [must(hasMoney(a, c), fmt$(c))] };
      },
    },
    {
      id: 2, kind: "fact", question: "Looking at 2026-08-01 through 2026-09-30, which day of the week has the highest average daily net revenue?",
      truth: async () => {
        const rs = await db.execute(`select wd, avg(n) a from (select business_date, strftime('%w', business_date) wd, sum(net_cents) n from orders where business_date between '2026-08-01' and '2026-09-30' group by 1) group by wd order by a desc limit 1`);
        const day = WEEKDAYS[Number(rs.rows[0]![0])]!;
        return { expected: day, grade: (a) => [must(new RegExp(day, "i").test(a.split("\n").slice(0, 3).join(" ")), `${day} named first`)] };
      },
    },
    {
      id: 3, kind: "fact", question: "What was total revenue in September 2026?",
      truth: async () => {
        const v = (await kpi(P, "total_revenue")).value!;
        return { expected: fmt$(v), grade: (a) => [must(hasMoney(a, v), fmt$(v))] };
      },
    },
    {
      id: 4, kind: "fact", question: "What was year-over-year revenue growth in September 2026?",
      truth: async () => {
        const v = (await kpi(P, "revenue_growth_pct")).value!;
        return { expected: `${v}%`, grade: (a) => [must(hasPct(a, v), `${v}%`)] };
      },
    },
    {
      id: 5, kind: "fact", question: "What was our net margin in September 2026?",
      truth: async () => {
        const b = await views.getCostBreakdown({ period: P });
        const nm = (await kpi(P, "net_margin_pct")).value;
        if (nm !== b.contributionPct) throw new Error(`net_margin_pct ${nm} ≠ contribution ${b.contributionPct}`);
        return { expected: `${b.contributionPct}%`, grade: (a) => [must(hasPct(a, b.contributionPct!), `${b.contributionPct}%`)] };
      },
    },
    {
      id: 6, kind: "fact", question: "How much did we spend on shipping labels in September 2026?",
      truth: async () => {
        const c = (await views.getCostBreakdown({ period: P })).shippingLabels.costCents;
        return { expected: fmt$(c), grade: (a) => [must(hasMoney(a, c), fmt$(c))] };
      },
    },
    {
      id: 7, kind: "fact", question: "What was our processing labor cost in September 2026?",
      truth: async () => {
        const c = (await views.getCostBreakdown({ period: P })).labor.costCents;
        return { expected: fmt$(c), grade: (a) => [must(hasMoney(a, c), fmt$(c))] };
      },
    },
    {
      id: 8, kind: "fact", question: "Which product category had the best fully costed contribution in September 2026?",
      truth: async () => {
        const m = await views.getCostedMargin({ period: P, by: "category" });
        const top = m.groups.find((g) => g.group !== "Uncategorized" && g.group !== "Unallocated")!;
        return {
          expected: `${top.group} (${fmt$(top.contributionCents)})`,
          grade: (a) => [must(hasName(a.split("\n").slice(0, 3).join(" "), top.group), `${top.group} named first`)],
        };
      },
    },
    {
      id: 9, kind: "fact", question: "Which sales channel had the worst contribution margin % in September 2026?",
      truth: async () => {
        const m = await views.getCostedMargin({ period: P, by: "channel" });
        const worst = [...m.groups].filter((g) => g.contributionPct !== null).sort((x, y) => x.contributionPct! - y.contributionPct!)[0]!;
        return {
          expected: `${worst.group} (${worst.contributionPct}%)`,
          grade: (a) => [must(hasName(a, worst.group), worst.group), must(hasPct(a, worst.contributionPct!), `${worst.contributionPct}%`)],
        };
      },
    },
    {
      id: 10, kind: "fact", question: "What was the repeat buyer rate in September 2026?",
      truth: async () => {
        const v = (await kpi(P, "repeat_buyer_rate")).value!;
        return { expected: `${v}%`, grade: (a) => [must(hasPct(a, v), `${v}%`)] };
      },
    },
    {
      id: 11, kind: "fact", question: "How many open data issues are there right now?",
      truth: async () => {
        const c = Number(await scalar("select count(*) from exceptions where status = 'open'"));
        return { expected: String(c), grade: (a) => [must(hasCount(a, c), `${c} open`)] };
      },
    },
    {
      id: 12, kind: "fact", question: "Which channel drove most of the revenue drop from 2026-10-01 to 2026-10-02, and by how much?",
      truth: async () => {
        const [d1, d2] = await Promise.all([views.getPulse("2026-10-01"), views.getPulse("2026-10-02")]);
        const deltas = d2.rows.map((r) => ({ ch: r.channelId, d: (r.revenueCents ?? 0) - (d1.rows.find((x) => x.channelId === r.channelId)?.revenueCents ?? 0) }));
        const top = deltas.sort((x, y) => x.d - y.d)[0]!;
        return {
          expected: `${top.ch} (${fmt$(top.d)})`,
          grade: (a) => [must(hasName(a, top.ch), top.ch), must(hasMoney(a, top.d), fmt$(Math.abs(top.d)))],
        };
      },
    },
    // ---- Reasoning quality ------------------------------------------------------
    {
      id: 13, kind: "reasoning", question: "Why were sales lower on 2026-10-02 than the day before?",
      truth: async () => {
        const [d1, d2] = await Promise.all([views.getPulse("2026-10-01"), views.getPulse("2026-10-02")]);
        const deltas = d2.rows.map((r) => ({ ch: r.channelId, d: (r.revenueCents ?? 0) - (d1.rows.find((x) => x.channelId === r.channelId)?.revenueCents ?? 0) }));
        const top = deltas.sort((x, y) => x.d - y.d)[0]!;
        const status = await views.getSourceStatus("2026-10");
        const complete = d2.missingChannels.length === 0 && !status.sources.some((s) => s.missingDates?.includes("2026-10-02"));
        const totalDrop = d2.totals.revenueCents - d1.totals.revenueCents;
        return {
          expected: `${top.ch} ${fmt$(top.d)} of ${fmt$(totalDrop)}; data ${complete ? "complete" : "INCOMPLETE"}`,
          grade: (a) => [
            must(hasName(a, top.ch), `driver ${top.ch}`),
            must(hasMoney(a, top.d), `driver amount ${fmt$(Math.abs(top.d))}`),
            must(
              complete
                ? /\b(complete|no (reported |missing )?(data )?(missing|gaps?)|not missing|all (\w+ )?(sources|channels|files|reports)|nothing (is )?missing|not a data (gap|issue))/i.test(a)
                : /missing|incomplete|gap/i.test(a),
              complete ? "says data complete" : "flags missing data",
            ),
          ],
        };
      },
    },
    {
      id: 14, kind: "reasoning", question: "Which channel should we prioritize listing on?",
      truth: async () => {
        const m = await views.getCostedMargin({ period: P, by: "channel" });
        const cands = m.groups.filter((g) => g.avgDaysToSell !== null && g.contributionPct !== null && g.contributionPct > 0)
          .sort((x, y) => y.contributionCents - x.contributionCents).slice(0, 2);
        return {
          expected: cands.map((g) => `${g.group}: ${g.contributionPct}% contribution, ${g.avgDaysToSell} days to sell`).join(" | "),
          grade: (a) => {
            const lead = a.split("\n").slice(0, 3).join(" ");
            const pick = cands.find((g) => hasName(lead, g.group)) ?? cands.find((g) => hasName(a, g.group));
            return [
              must(Boolean(pick), `recommends ${cands.map((g) => g.group).join(" or ")}`),
              must(Boolean(pick && hasPct(a, pick.contributionPct!)), `cites contribution % ${pick?.contributionPct ?? ""}`),
              must(Boolean(pick && hasPct(a, pick.avgDaysToSell!)), `cites days to sell ${pick?.avgDaysToSell ?? ""}`),
            ];
          },
        };
      },
    },
    {
      id: 15, kind: "reasoning", question: "What were our costs in September 2026?",
      truth: async () => {
        const b = await views.getCostBreakdown({ period: P });
        const items: [string, number][] = [
          ["marketplace fees", b.revenue.marketplaceFeesCents],
          ["shipping labels", b.shippingLabels.costCents],
          ["labor", b.labor.costCents],
          ["other charges", b.otherCharges.costCents],
        ];
        return {
          expected: items.map(([k, v]) => `${k} ${fmt$(v)}`).join(", "),
          grade: (a) => [
            ...items.map(([k, v]) => must(hasMoney(a, v), `${k} ${fmt$(v)}`)),
            must(/overhead/i.test(a), "mentions overhead is not included"),
          ],
        };
      },
    },
    {
      id: 16, kind: "reasoning", question: "Is our September 2026 net margin on track against target, and what is holding it back?",
      truth: async () => {
        const k = await kpi(P, "net_margin_pct");
        const b = await views.getCostBreakdown({ period: P });
        return {
          expected: `${k.value}% vs target ${k.target}%; biggest cost labor ${fmt$(b.labor.costCents)} / shipping ${fmt$(b.shippingLabels.costCents)}`,
          grade: (a) => [
            must(hasPct(a, k.value!), `value ${k.value}%`),
            must(hasPct(a, k.target!), `target ${k.target}%`),
            must(hasMoney(a, b.labor.costCents) || hasMoney(a, b.shippingLabels.costCents), "cites labor or shipping cost $"),
            must(/suggest/i.test(a), "labeled suggestion"),
          ],
        };
      },
    },
  ];

  const only = arg("--only")?.split(",").map(Number);
  const selected = only ? cases.filter((c) => only.includes(c.id)) : cases;
  const concurrency = Number(arg("--concurrency") ?? 3);
  const verbose = args.includes("--verbose");

  interface Result {
    c: Case;
    expected: string;
    answer: string;
    checks: Check[];
    cost: number;
    input: number;
    cached: number;
    tools: string[];
    error?: string;
  }
  const results: Result[] = [];
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (next < selected.length) {
      const c = selected[next++]!;
      let answer = "";
      const tools: string[] = [];
      let error: string | undefined;
      try {
        const t = await c.truth();
        const usage = await runChat({
          messages: [{ role: "user", content: c.question }],
          emit: (e) => {
            if (e.type === "text") answer += e.delta;
            else if (e.type === "tool") tools.push(e.name);
            else if (e.type === "error") error = e.message;
          },
        });
        results.push({
          c, expected: t.expected, answer, checks: t.grade(answer), cost: usage.estimatedCostUsd ?? 0,
          input: usage.inputTokens, cached: usage.cachedInputTokens, tools, error,
        });
      } catch (err) {
        results.push({ c, expected: "?", answer, checks: [must(false, "ran")], cost: 0, input: 0, cached: 0, tools, error: err instanceof Error ? err.message : String(err) });
      }
      process.stderr.write(".");
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  process.stderr.write("\n");
  results.sort((a, b) => a.c.id - b.c.id);

  const pass = (r: Result) => r.checks.every((x) => x.ok) && !r.error;
  const firstLine = (s: string) => s.replace(/\*\*/g, "").split("\n").find((l) => l.trim())?.trim() ?? "";
  console.log(`\n| # | kind | question | expected | got (first line) | result | cost |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const failed = r.checks.filter((x) => !x.ok).map((x) => x.expected);
    const got = firstLine(r.answer).slice(0, 140).replace(/\|/g, "/");
    console.log(
      `| ${r.c.id} | ${r.c.kind} | ${r.c.question} | ${r.expected} | ${got} | ${pass(r) ? "PASS" : `FAIL: ${[...failed, r.error].filter(Boolean).join("; ")}`} | $${r.cost.toFixed(4)} |`,
    );
  }
  if (verbose) {
    for (const r of results) {
      console.log(`\n--- #${r.c.id} ${r.c.question}\n[tools: ${r.tools.join(", ")}]\n${r.answer}`);
    }
  }
  const passed = results.filter(pass).length;
  const cost = results.reduce((s, r) => s + r.cost, 0);
  const input = results.reduce((s, r) => s + r.input, 0);
  const cached = results.reduce((s, r) => s + r.cached, 0);
  console.log(
    `\n${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%) · est. cost $${cost.toFixed(4)} · input ${input} tokens, cached ${cached} (${input ? Math.round((cached / input) * 100) : 0}%) · ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
  if (!verbose) {
    for (const r of results.filter((x) => !pass(x))) {
      console.log(`\n--- FAIL #${r.c.id} ${r.c.question}\n[tools: ${r.tools.join(", ")}]\n${r.answer}`);
    }
  }
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
