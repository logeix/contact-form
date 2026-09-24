/// <reference types="@cloudflare/workers-types" />
/**
 * Client for the lgx-spam-check Worker, reached through the site's SPAM_CHECK service binding.
 * The Worker holds the AI key and decides per site whether its verdict is only recorded
 * ("shadow") or acted on ("enforce"). Any failure keeps the rules' decision.
 */

import type { PhoneLocale, SpamAssessment } from "./types";
import { phoneStatus } from "./spam";

const CHECK_URL = "https://spam-check.internal/v1/check";
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_DETAIL_CHARS = 200;
/** Contact details never leave the site; other short fields (service, property type) go along as context. */
const PRIVATE_FIELDS = new Set([
  "name",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "address",
  "street",
  "postcode",
  "zip",
  "zipcode",
  "source",
  "submit",
  "message",
]);

export type AiVerdict =
  | {
      ok: true;
      mode: "shadow" | "enforce";
      verdict: "allow" | "review" | "block";
      pSpam: number;
      choice: string;
    }
  | { ok: false; error: string };

export function buildAiCheckPayload(params: {
  site: string;
  formName: string;
  submittedAt: string;
  formData: Record<string, string>;
  phoneLocale: PhoneLocale;
  assessment: SpamAssessment;
}) {
  const { formData } = params;
  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (Object.keys(details).length >= 10) break;
    const trimmed = (value || "").trim();
    if (!trimmed || PRIVATE_FIELDS.has(key.toLowerCase())) continue;
    details[key] = trimmed.slice(0, MAX_DETAIL_CHARS);
  }
  const email = (formData.email || "").trim();
  return {
    site: params.site,
    form: params.formName,
    submittedAt: params.submittedAt,
    message: (formData.message || "").slice(0, MAX_MESSAGE_CHARS),
    details,
    emailDomain: email.includes("@") ? email.split("@").pop() : undefined,
    phone: phoneStatus(formData.phone || "", params.phoneLocale),
    phoneLocale: params.phoneLocale,
    rules: {
      decision: params.assessment.decision,
      score: params.assessment.score,
      reasons: params.assessment.reasons,
    },
  };
}

export async function requestAiVerdict(
  binding: Fetcher,
  payload: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AiVerdict> {
  try {
    const res = await binding.fetch(CHECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const mode = data?.mode;
    const verdict = data?.verdict;
    if (
      data?.ok === true &&
      (mode === "shadow" || mode === "enforce") &&
      (verdict === "allow" || verdict === "review" || verdict === "block")
    ) {
      return { ok: true, mode, verdict, pSpam: Number(data.pSpam ?? 0), choice: String(data.choice ?? "") };
    }
    return { ok: false, error: typeof data?.error === "string" ? data.error : `http_${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable",
    };
  }
}

/** Stored in spam_reasons, e.g. `ai-shadow:block:sales_pitch:0.97` or `ai-error:timeout`. */
export function aiReason(v: AiVerdict): string {
  if (!v.ok) return `ai-error:${v.error}`;
  return `${v.mode === "enforce" ? "ai" : "ai-shadow"}:${v.verdict}:${v.choice}:${v.pSpam.toFixed(2)}`;
}

/**
 * Enforce mode replaces the content rules' decision (review = deliver with a subject flag).
 * Shadow mode and failures only add a reason, so the rules keep deciding.
 */
export function applyAiVerdict(
  assessment: SpamAssessment,
  v: AiVerdict,
): { assessment: SpamAssessment; subjectPrefix: string } {
  const reasons = [...assessment.reasons, aiReason(v)];
  if (!v.ok || v.mode === "shadow") {
    return { assessment: { ...assessment, reasons }, subjectPrefix: "" };
  }
  if (v.verdict === "block") {
    return { assessment: { ...assessment, decision: "blocked", score: 100, reasons }, subjectPrefix: "" };
  }
  return {
    assessment: { ...assessment, decision: "allow", reasons },
    subjectPrefix: v.verdict === "review" ? "[Possible spam] " : "",
  };
}
