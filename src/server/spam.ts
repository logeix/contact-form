/// <reference types="@cloudflare/workers-types" />

import { ATTRIBUTION_FIELD } from "../attribution";
import {
  DEFAULT_AUX_FIELDS,
  FORM_BUILD_FIELD,
  FORM_NAME_FIELD,
  TIMESTAMP_FIELD,
  parseFormBuild,
  uniqueFieldNames,
} from "../shared";
import { HARD_SPAM_TERMS, SCORE_SPAM_TERMS } from "./terms";
import type { PhoneLocale, SpamAssessment, SubmitFormOptions } from "./types";

const DEFAULT_MIN_FILL_MS = 3000;
const DEFAULT_BLOCK_SCORE = 3;

export function auxFieldNames(
  formData: Record<string, string>,
  extra: string[] | undefined,
): string[] {
  return uniqueFieldNames([
    ...DEFAULT_AUX_FIELDS,
    ...(extra ?? []),
    ...parseFormBuild(formData[FORM_BUILD_FIELD]),
  ]);
}

export function auxFieldFilled(
  formData: Record<string, string>,
  names: string[],
): boolean {
  return names.some((name) => Boolean((formData[name] || "").trim()));
}

export function stripMetaFields(
  formData: Record<string, string>,
  auxNames: string[],
): Record<string, string> {
  const clean = { ...formData };
  delete clean[FORM_NAME_FIELD];
  delete clean[TIMESTAMP_FIELD];
  delete clean[FORM_BUILD_FIELD];
  delete clean[ATTRIBUTION_FIELD];
  for (const name of auxNames) delete clean[name];
  return clean;
}

function normaliseText(input: string): string {
  return input.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function phoneScoreReason(rawPhone: string, locale: PhoneLocale): string | null {
  if (!rawPhone) return null;
  if (locale === "uk") {
    const compact = rawPhone.replace(/[\s\-().]/g, "");
    if (!/^(\+44|0)[0-9]{9,10}$/.test(compact)) return "non-uk-phone";
    return null;
  }
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length > 0 && !/^1?[2-9]\d{9}$/.test(digits)) return "non-us-phone";
  return null;
}

export function phoneStatus(rawPhone: string, locale: PhoneLocale): "valid" | "invalid" | "missing" {
  if (!rawPhone.trim()) return "missing";
  return phoneScoreReason(rawPhone, locale) ? "invalid" : "valid";
}

export async function assessFormSpam(params: {
  db: D1Database;
  formData: Record<string, string>;
  ipAddress: string;
  options: SubmitFormOptions;
  mode: "full" | "gates";
}): Promise<SpamAssessment> {
  const { db, formData, ipAddress, options, mode } = params;
  const reasons: string[] = [];
  let score = 0;
  const minFillMs = options.minFillMs ?? DEFAULT_MIN_FILL_MS;
  const blockScoreAt = options.blockScoreAt ?? DEFAULT_BLOCK_SCORE;
  const locale = options.phoneLocale ?? "nanp";

  const clientTimestamp = Number(formData[TIMESTAMP_FIELD] || 0);
  let elapsedMs: number | undefined;
  if (Number.isFinite(clientTimestamp) && clientTimestamp > 0) {
    elapsedMs = Date.now() - clientTimestamp;
    // Negative elapsed = client clock ahead / forged future timestamp
    if (elapsedMs < 0 || elapsedMs < minFillMs) {
      reasons.push(elapsedMs < 0 ? "invalid-client-timestamp" : "submitted-too-fast");
      return { decision: "blocked", score: 100, reasons, elapsedMs, stage: "gate" };
    }
  } else {
    reasons.push("missing-client-timestamp");
    return { decision: "blocked", score: 100, reasons, elapsedMs, stage: "gate" };
  }

  if (mode === "gates") {
    return { decision: "allow", score: 0, reasons, elapsedMs, stage: "gate" };
  }

  // Rate limits are bot gates too, so they run before the content rules the AI check can overrule.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const formName = formData[FORM_NAME_FIELD] || "contact";

  const ipRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM form_submissions
       WHERE form_name = ? AND submitted_at >= ? AND ip_address = ?`,
    )
    .bind(formName, tenMinutesAgo, ipAddress)
    .first<{ c: number }>();
  if (Number(ipRow?.c || 0) >= 3) {
    reasons.push("ip-rate-limited");
    return { decision: "blocked", score: 100, reasons, elapsedMs, stage: "gate" };
  }

  const email = (formData.email || "").trim().toLowerCase();
  if (email) {
    const emailRow = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM form_submissions
         WHERE form_name = ? AND submitted_at >= ?
           AND json_extract(form_data, '$.email') = ?`,
      )
      .bind(formName, tenMinutesAgo, email)
      .first<{ c: number }>();
    if (Number(emailRow?.c || 0) >= 2) {
      reasons.push("email-rate-limited");
      return { decision: "blocked", score: 100, reasons, elapsedMs, stage: "gate" };
    }
  }

  if (/(https?:\/\/|www\.)/i.test(formData.message || "")) {
    reasons.push("contains-link");
    return { decision: "blocked", score: 100, reasons, elapsedMs, stage: "content" };
  }

  const msg = normaliseText(formData.message || "");
  const hardTerms = [...HARD_SPAM_TERMS, ...(options.extraHardTerms ?? [])];
  for (const term of hardTerms) {
    if (msg.includes(normaliseText(term))) {
      reasons.push(`hard-term:${term}`);
      return { decision: "blocked", score: 100, reasons, elapsedMs, stage: "content" };
    }
  }

  const scoreTerms = [...SCORE_SPAM_TERMS, ...(options.extraScoreTerms ?? [])];
  for (const term of scoreTerms) {
    if (msg.includes(normaliseText(term))) {
      score += 2;
      reasons.push(`score-term:${term}`);
    }
  }

  if ((formData.message || "").length > 550) {
    score += 2;
    reasons.push("message-too-long");
  }

  const paragraphBreaks = (formData.message || "").split(/\r?\n/).filter(Boolean).length;
  if (paragraphBreaks >= 8) {
    score += 1;
    reasons.push("many-paragraphs");
  }

  const phoneReason = phoneScoreReason(formData.phone || "", locale);
  if (phoneReason) {
    score += 2;
    reasons.push(phoneReason);
  }

  if (score >= blockScoreAt) {
    return { decision: "blocked", score, reasons, elapsedMs, stage: "content" };
  }

  return { decision: "allow", score, reasons, elapsedMs, stage: "content" };
}
