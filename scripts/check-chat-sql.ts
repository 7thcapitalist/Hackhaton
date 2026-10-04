/**
 * Unit check for the chat's read-only SQL guard (src/ai/chat/sql-guard.ts).
 * Run: npm run check:chat-sql   (pure, no DB, no API key)
 */
import { guardSql } from "../src/ai/chat/sql-guard";

const accept: string[] = [
  "SELECT 1",
  "select count(*) from orders",
  "SELECT * FROM orders;",
  "  SELECT business_date, SUM(net_cents) FROM orders GROUP BY 1  ;  ",
  "WITH d AS (SELECT business_date, SUM(net_cents) n FROM orders GROUP BY 1) SELECT * FROM d ORDER BY n DESC",
  "SELECT strftime('%w', business_date) AS wd, SUM(net_cents) FROM orders GROUP BY wd",
  "SELECT 'a;b' AS s",
  "SELECT 'it''s; DELETE' AS s",
  "SELECT category FROM orders -- trailing comment",
  "SELECT /* inline */ channel FROM orders",
  "SELECT \"category\" FROM orders WHERE note = 'drop table'",
  "SELECT updated_count, created_by FROM t",
  "SELECT name FROM sqlite_master WHERE type = 'table'",
];

const reject: string[] = [
  "",
  "   ",
  "DELETE FROM orders",
  "delete from orders where 1=1",
  "SELECT 1; DELETE FROM orders",
  "SELECT 1; SELECT 2",
  "SELECT 1;; ",
  "PRAGMA table_info(orders)",
  "SELECT * FROM pragma_table_info('orders')",
  "ATTACH DATABASE 'x.db' AS x",
  "SELECT * FROM golden_orders",
  "SELECT * FROM \"golden_orders\"",
  "SELECT * FROM [GOLDEN_ORDERS]",
  "SELECT * FROM `golden_meta`",
  "INSERT INTO orders (id) VALUES ('x')",
  "UPDATE orders SET net_cents = 0",
  "DROP TABLE orders",
  "ALTER TABLE orders ADD COLUMN x",
  "CREATE TABLE x (a)",
  "REPLACE INTO orders (id) VALUES ('x')",
  "VACUUM",
  "WITH x AS (SELECT 1) DELETE FROM orders",
  "WITH x AS (SELECT 1) INSERT INTO orders SELECT * FROM x",
  "SELECT 1 /* ; */ ; DROP TABLE orders",
  "SELECT 1 -- comment\n; DELETE FROM orders",
  "SEL/**/ECT 1",
  "/* hi */ DELETE FROM orders",
  "-- SELECT\nDELETE FROM orders",
  "SELECT 1 /* unterminated",
  "SELECT 'unterminated",
  "SELECT load_extension('x')",
  "SELECT 1 FROM orders; PRAGMA writable_schema=1",
  "EXPLAIN SELECT 1",
  "SELECT * FROM orders WHERE id IN (SELECT id FROM golden_orders)",
];

let failures = 0;
for (const q of accept) {
  const r = guardSql(q);
  const ok = r.ok;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} accept  ${JSON.stringify(q)}${r.ok ? "" : `  -> ${r.reason}`}`);
}
for (const q of reject) {
  const r = guardSql(q);
  const ok = !r.ok;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} reject  ${JSON.stringify(q)}${r.ok ? "  -> accepted!" : `  -> ${r.reason}`}`);
}

// The LIMIT wrapper must survive a trailing comment.
const w = guardSql("SELECT * FROM orders -- no limit please");
const wrapOk = w.ok && /\)\s*LIMIT 500$/.test(w.wrapped) && !w.wrapped.includes("--");
if (!wrapOk) failures++;
console.log(`${wrapOk ? "PASS" : "FAIL"} wrapper keeps LIMIT 500 after a trailing comment`);

const total = accept.length + reject.length + 1;
console.log(`\n${total - failures}/${total} passed`);
if (failures) process.exit(1);
