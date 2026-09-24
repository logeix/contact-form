/**
 * lgx-spam-check — central AI spam check for LOGEIX client contact forms.
 *
 * Sites never call this over the internet: @logeix/contact-form reaches it through a
 * Cloudflare service binding (SPAM_CHECK) at https://spam-check.internal/v1/check.
 * Any other hostname (workers.dev) needs `Authorization: Bearer <ADMIN_TOKEN>`.
 *
 * Holds the Jev key, the question, the thresholds, and a verdict log in its own D1.
 * The log never stores message text or contact details.
 */

export interface Env {
  DB: D1Database;
  OPENROUTER_JEV_KEY?: string;
  ADMIN_TOKEN?: string;
  /** "shadow" (default): sites record the verdict only. "enforce": sites act on it. */
  MODE?: string;
  /** Comma-separated SITE_NAMEs to enforce while MODE stays "shadow". */
  ENFORCE_SITES?: string;
  JEV_MODEL?: string;
  BLOCK_AT?: string;
  REVIEW_AT?: string;
}

export type CheckRequest = {
  site: string;
  form: string;
  submittedAt?: string;
  message: string;
  /** Short non-contact fields such as service or property_type. */
  details?: Record<string, string>;
  emailDomain?: string;
  phone?: "valid" | "invalid" | "missing";
  phoneLocale?: "nanp" | "uk";
  rules?: { decision: string; score: number; reasons: string[] };
  /** Admin testing: skip the verdict log. */
  dryRun?: boolean;
};

export type Verdict = "allow" | "review" | "block";

const INTERNAL_HOST = "spam-check.internal";
const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";
const JEV_TIMEOUT_MS = 3500;
const MAX_MESSAGE_CHARS = 4000;
const MAX_DETAIL_CHARS = 200;

/** What each site's contact form is for, keyed by the site's SITE_NAME var. */
const SITE_CONTEXT: Record<string, string> = {
  "4-ducks-duct-cleaning": "4 Ducks Duct Cleaning, a local air duct and dryer vent cleaning company in the US",
  "asap-plumbing-pros": "ASAP Plumbing Pros, a local plumbing company in the US",
  mackheat: "Macklin Heating and Cooling, a local heating and air conditioning company in the US",
  "main-plumbing-services": "Main Plumbing Services, a local plumbing company in the US",
  "r-stud-plumbing": "R Stud Plumbing, a local plumbing company in the US",
  "sams-gutters": "Sam's Gutter Cleaning, a local gutter cleaning and repair company in the UK",
};
const DEFAULT_CONTEXT = "A small local home-service business";

const QUESTIONS = {
  intent: {
    type: "choice",
    instructions:
      "This message came through the website contact form of the business described. Why did the sender write it? Judge the purpose, not the writing style: real customers often write long, formal, or AI-assisted messages, and may mention reviews, prices, or links to photos.",
    criteria: {
      customer:
        "Wants this business to do work for them: a quote, booking, repair, inspection, or a question about a job. Includes homeowners, tenants, landlords, property managers, businesses, and existing customers following up.",
      sales_pitch:
        "Is selling something to this business: marketing, SEO, websites, ads, leads, reviews, backlinks, software, answering services, staffing, financing, or an offer to buy the business.",
      other_contact:
        "A real person with a reason that is neither hiring the business nor selling to it, such as a job applicant.",
      junk: "Gibberish, a test entry, a scam, or not a genuine message.",
    },
  },
} as const;

/** Probability mass on these choices is the spam score. */
const SPAM_CHOICES = ["sales_pitch", "junk"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function numberVar(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const given = new TextEncoder().encode(request.headers.get("Authorization") ?? "");
  const expected = new TextEncoder().encode(`Bearer ${env.ADMIN_TOKEN}`);
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

export function parseCheckRequest(raw: unknown): CheckRequest {
  if (!raw || typeof raw !== "object") throw new Error("bad_request");
  const body = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  const site = text(body.site, 100);
  const message = text(body.message, MAX_MESSAGE_CHARS);
  if (!site || !message.trim()) throw new Error("bad_request");

  const details: Record<string, string> = {};
  if (body.details && typeof body.details === "object") {
    for (const [key, value] of Object.entries(body.details as Record<string, unknown>).slice(0, 10)) {
      if (typeof value === "string" && value.trim()) details[key.slice(0, 40)] = value.slice(0, MAX_DETAIL_CHARS);
    }
  }

  const rules = body.rules as CheckRequest["rules"] | undefined;
  return {
    site,
    form: text(body.form, 100) || "contact",
    submittedAt: text(body.submittedAt, 40) || undefined,
    message,
    details,
    emailDomain: text(body.emailDomain, 100) || undefined,
    phone: body.phone === "valid" || body.phone === "invalid" ? body.phone : "missing",
    phoneLocale: body.phoneLocale === "uk" ? "uk" : "nanp",
    rules:
      rules && typeof rules === "object"
        ? {
            decision: String(rules.decision ?? ""),
            score: Number(rules.score ?? 0),
            reasons: Array.isArray(rules.reasons) ? rules.reasons.map(String).slice(0, 30) : [],
          }
        : undefined,
    dryRun: body.dryRun === true,
  };
}

/** Only what the decision needs: no name, phone digits, or email local part. */
export function buildState(req: CheckRequest): Record<string, string> {
  const country = req.phoneLocale === "uk" ? "UK" : "US";
  const state: Record<string, string> = {
    business: SITE_CONTEXT[req.site] ?? DEFAULT_CONTEXT,
    message: req.message,
  };
  for (const [key, value] of Object.entries(req.details ?? {})) {
    const label = key.replace(/[_-]+/g, " ");
    if (!(label in state)) state[label] = value;
  }
  state["sender email domain"] = req.emailDomain || "not provided";
  state["phone number"] =
    req.phone === "valid"
      ? `valid ${country} number`
      : req.phone === "invalid"
        ? `not a valid ${country} number`
        : "not provided";
  return state;
}

/**
 * Only sales pitches get blocked. "Junk" is in practice people testing their own form, so it is
 * delivered flagged for review instead of silently disappearing.
 */
export function band(probabilities: Record<string, number>, blockAt: number, reviewAt: number): Verdict {
  const pitch = probabilities.sales_pitch ?? 0;
  const spam = pitch + (probabilities.junk ?? 0);
  if (pitch >= blockAt) return "block";
  if (spam >= reviewAt) return "review";
  return "allow";
}

export function modeFor(env: Pick<Env, "MODE" | "ENFORCE_SITES">, site: string): "shadow" | "enforce" {
  if ((env.MODE ?? "").trim().toLowerCase() === "enforce") return "enforce";
  const enforced = (env.ENFORCE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return enforced.includes(site) ? "enforce" : "shadow";
}

type JevResult = {
  choice: string;
  probabilities: Record<string, number>;
  model: string;
  inputTokens: number;
  costUsd: number | null;
};

async function askJev(env: Env, state: Record<string, string>): Promise<JevResult> {
  let response: Response;
  try {
    response = await fetch(JEV_DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_JEV_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "LOGEIX contact form spam check",
      },
      body: JSON.stringify({ model: env.JEV_MODEL || DEFAULT_JEV_MODEL, state, questions: QUESTIONS }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err instanceof Error && err.name === "TimeoutError" ? "jev_timeout" : "jev_unreachable");
  }
  if (!response.ok) throw new Error(`jev_http_${response.status}`);

  const body = (await response.json().catch(() => null)) as {
    model?: string;
    answers?: { intent?: { type?: string; choice?: string; probabilities?: Record<string, number> } };
    usage?: { input_tokens?: number; cost?: number };
  } | null;
  const answer = body?.answers?.intent;
  if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" || !answer.probabilities) {
    throw new Error("jev_invalid_response");
  }
  return {
    choice: answer.choice,
    probabilities: answer.probabilities,
    model: String(body?.model ?? env.JEV_MODEL ?? DEFAULT_JEV_MODEL),
    inputTokens: Number(body?.usage?.input_tokens ?? 0),
    costUsd: typeof body?.usage?.cost === "number" ? body.usage.cost : null,
  };
}

async function logVerdict(
  env: Env,
  req: CheckRequest,
  row: {
    mode: string;
    verdict?: Verdict;
    pSpam?: number;
    jev?: JevResult;
    latencyMs: number;
    error?: string;
  }
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO verdicts
       (created_at, site, form, submitted_at, mode, verdict, p_spam, choice, probabilities_json,
        rules_decision, rules_reasons_json, message_chars, latency_ms, input_tokens, cost_usd, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        new Date().toISOString(),
        req.site,
        req.form,
        req.submittedAt ?? null,
        row.mode,
        row.verdict ?? null,
        row.pSpam ?? null,
        row.jev?.choice ?? null,
        row.jev ? JSON.stringify(row.jev.probabilities) : null,
        req.rules?.decision ?? null,
        req.rules ? JSON.stringify(req.rules.reasons) : null,
        req.message.length,
        row.latencyMs,
        row.jev?.inputTokens ?? null,
        row.jev?.costUsd ?? null,
        row.jev?.model ?? null,
        row.error ?? null
      )
      .run();
  } catch (err) {
    console.error("[lgx-spam-check] verdict log failed", err);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== INTERNAL_HOST && !(await isAdmin(request, env))) {
      return json({ ok: false, error: "not_found" }, 404);
    }
    if (request.method !== "POST" || url.pathname !== "/v1/check") {
      return json({ ok: false, error: "not_found" }, 404);
    }

    let req: CheckRequest;
    try {
      req = parseCheckRequest(await request.json());
    } catch {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const mode = modeFor(env, req.site);
    const started = Date.now();
    try {
      if (!env.OPENROUTER_JEV_KEY) throw new Error("missing_key");
      const jev = await askJev(env, buildState(req));
      const pSpam = SPAM_CHOICES.reduce((sum, key) => sum + (jev.probabilities[key] ?? 0), 0);
      const verdict = band(jev.probabilities, numberVar(env.BLOCK_AT, 0.85), numberVar(env.REVIEW_AT, 0.5));
      const latencyMs = Date.now() - started;
      if (!req.dryRun) ctx.waitUntil(logVerdict(env, req, { mode, verdict, pSpam, jev, latencyMs }));
      return json({
        ok: true,
        mode,
        verdict,
        pSpam: Math.round(pSpam * 1000) / 1000,
        choice: jev.choice,
        probabilities: jev.probabilities,
        model: jev.model,
        latencyMs,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown_error";
      const latencyMs = Date.now() - started;
      console.error("[lgx-spam-check]", req.site, error);
      if (!req.dryRun) ctx.waitUntil(logVerdict(env, req, { mode, latencyMs, error }));
      return json({ ok: false, mode, error }, 502);
    }
  },
};
