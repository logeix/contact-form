#!/usr/bin/env node
/**
 * Backtest the AI spam check on past contact submissions from every client site.
 *
 * Reads each site's form_submissions (Cloudflare D1, via wrangler), keeps rows the bot gates
 * let through (so only content-rule decisions), sends them to the deployed lgx-spam-check
 * Worker over workers.dev with dryRun (nothing is logged), and compares the Worker's verdict
 * with what the phrase/length rules decided.
 *
 *   ADMIN_TOKEN=... node scripts/backtest-sites.mjs --out C:\temp\spam-backtest.json
 *
 * Prints counts only. The --out file holds messages and verdicts for review, so delete it after.
 * Needs wrangler access to the LOGEIX Cloudflare account and the Worker's ADMIN_TOKEN. That secret
 * is normally unset, which closes the workers.dev entrance: in worker/, run
 * `npx wrangler secret put ADMIN_TOKEN` with a fresh random value, run this, then
 * `npx wrangler secret delete ADMIN_TOKEN`.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ACCOUNT_ID = "273878c2a1ea5cc2b33b5ccb2945cac8";
const WORKER_URL = "https://lgx-spam-check.lovefone.workers.dev/v1/check";
/** SITE_NAME → forms D1, matching each site's wrangler.toml. */
const SITES = {
  "4-ducks-duct-cleaning": { db: "4-ducks-duct-cleaning-forms", locale: "nanp", forms: ["contact", "estimate"] },
  "asap-plumbing-pros": { db: "asap-plumbing-pros-forms", locale: "nanp", forms: ["contact"] },
  mackheat: { db: "mackheat-forms", locale: "nanp", forms: ["contact"] },
  "main-plumbing-services": { db: "main-plumbing-services-forms", locale: "nanp", forms: ["contact"] },
  "r-stud-plumbing": { db: "r-stud-plumbing-forms", locale: "nanp", forms: ["contact"] },
  "sams-gutters": { db: "sams-gutters-forms", locale: "uk", forms: ["contact"] },
};
const GATE_REASONS = /^(honeypot-field-filled|missing-client-timestamp|submitted-too-fast|invalid-client-timestamp|ip-rate-limited|email-rate-limited)$/;
const PRIVATE_FIELDS = new Set(["name", "first_name", "last_name", "full_name", "email", "phone", "address", "street", "postcode", "zip", "zipcode", "source", "submit", "message"]);

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const TOKEN = (process.env.ADMIN_TOKEN || "").trim();
if (!TOKEN) throw new Error("Set ADMIN_TOKEN (the lgx-spam-check Worker's admin secret).");

function d1Rows(db, sql) {
  const win = process.platform === "win32";
  // npx is a .cmd shim on Windows, which needs a shell, and the shell splits unquoted args.
  const command = sql.replace(/\s+/g, " ").trim();
  const out = execFileSync(
    win ? "npx.cmd" : "npx",
    ["-y", "wrangler@4", "d1", "execute", db, "--remote", "--json", "--command", win ? `"${command}"` : command],
    { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: win },
  );
  return JSON.parse(out.slice(out.indexOf("[")))[0]?.results ?? [];
}

function phoneStatus(raw, locale) {
  if (!raw?.trim()) return "missing";
  if (locale === "uk") return /^(\+44|0)[0-9]{9,10}$/.test(raw.replace(/[\s\-().]/g, "")) ? "valid" : "invalid";
  return /^1?[2-9]\d{9}$/.test(raw.replace(/\D/g, "")) ? "valid" : "invalid";
}

async function check(payload) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, dryRun: true }),
  });
  return res.json();
}

const results = [];
for (const [site, cfg] of Object.entries(SITES)) {
  const forms = cfg.forms.map((f) => `'${f}'`).join(",");
  const rows = d1Rows(
    cfg.db,
    `SELECT id, form_name, submitted_at, form_data, spam_decision, spam_score, spam_reasons
     FROM form_submissions WHERE form_name IN (${forms}) AND spam_decision IS NOT NULL ORDER BY id`,
  );
  let kept = 0;
  for (const row of rows) {
    const reasons = JSON.parse(row.spam_reasons || "[]");
    if (reasons.some((r) => GATE_REASONS.test(r))) continue;
    const data = JSON.parse(row.form_data || "{}");
    if (!(data.message || "").trim()) continue;
    kept++;
    const details = {};
    for (const [k, v] of Object.entries(data)) {
      if (!PRIVATE_FIELDS.has(k.toLowerCase()) && String(v).trim()) details[k] = String(v).slice(0, 200);
    }
    const email = (data.email || "").trim();
    const verdict = await check({
      site,
      form: row.form_name,
      message: data.message,
      details,
      emailDomain: email.includes("@") ? email.split("@").pop() : undefined,
      phone: phoneStatus(data.phone || "", cfg.locale),
      phoneLocale: cfg.locale,
    });
    results.push({ site, id: row.id, submittedAt: row.submitted_at, rules: row.spam_decision, reasons, message: data.message, verdict });
  }
  console.log(`${site}: ${rows.length} rows, ${kept} passed the bot gates with a message`);
}

const ok = results.filter((r) => r.verdict?.ok);
const count = (fn) => ok.filter(fn).length;
console.log(`\nChecked ${results.length} (${results.length - ok.length} errors)`);
console.log(`                    AI allow  AI review  AI block`);
for (const rules of ["allow", "blocked"]) {
  const row = (v) => String(count((r) => r.rules === rules && r.verdict.verdict === v)).padStart(9);
  console.log(`rules ${rules.padEnd(8)}     ${row("allow")}  ${row("review")}  ${row("block")}`);
}
console.log(`\nAI top pick: ${Object.entries(ok.reduce((m, r) => ((m[r.verdict.choice] = (m[r.verdict.choice] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const ms = ok.map((r) => r.verdict.latencyMs).sort((a, b) => a - b);
console.log(`Worker→Jev latency p50 ${ms[Math.floor(ms.length / 2)]}ms, p95 ${ms[Math.floor(ms.length * 0.95)]}ms`);
if (OUT) {
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nDetails (contains messages) written to ${OUT}`);
}
