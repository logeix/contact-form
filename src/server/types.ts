/// <reference types="@cloudflare/workers-types" />

import type { FormAttributionMeta } from "../attribution";

export type SpamDecision = "allow" | "blocked";

export type PhoneLocale = "nanp" | "uk";

export interface SpamAssessment {
  decision: SpamDecision;
  score: number;
  reasons: string[];
  elapsedMs?: number;
  /**
   * Which layer produced the result: "gate" = bot checks (aux field, timing, rate limits),
   * "content" = phrase / link / length / phone rules. Only content results go to the AI check.
   */
  stage?: "gate" | "content";
}

export interface EmailContent {
  subject: string;
  html: string;
}

export interface SubmitFormEnv {
  DB: D1Database;
  BREVO_API_KEY: string;
  SITE_NAME: string;
  NOTIFICATION_EMAIL?: string;
  /** Optional service binding to the lgx-spam-check Worker (AI spam check). */
  SPAM_CHECK?: Fetcher;
}

export interface SubmissionContext {
  attribution: FormAttributionMeta | null;
}

export interface SubmitFormOptions {
  /** Build the notification email. `formName` is `contact`, `instant-quote`, etc. */
  buildEmail: (
    formName: string,
    data: Record<string, string>,
    context: SubmissionContext,
  ) => EmailContent;
  /** Phone format scoring. Default `nanp` (US/CA). Use `uk` for Sam's. */
  phoneLocale?: PhoneLocale;
  /** Used when `NOTIFICATION_EMAIL` is unset. */
  fallbackEmails?: string[];
  /** Extra immediate-block phrases (lowercased match after normalisation). */
  extraHardTerms?: string[];
  /** Extra +2 phrases. */
  extraScoreTerms?: string[];
  /**
   * Extra POST field names treated as aux (filled = bot).
   * Tagged `data-lgx-aux` fields are picked up automatically via `form_build`.
   */
  extraHoneypotFields?: string[];
  /** Forms that get the full phrase / length / phone / rate-limit scoring. Default `["contact"]`. */
  assessFormNames?: string[];
  /**
   * Forms that get timing + aux only (no phrase lists).
   * Useful for `instant-quote` without running the contact copy filter.
   */
  gateFormNames?: string[];
  /** Minimum ms between page load timestamp and submit. Default 3000. */
  minFillMs?: number;
  /** Accumulated score that blocks. Default 3. */
  blockScoreAt?: number;
  /**
   * Ask the SPAM_CHECK Worker about messages that pass the bot gates. Default true
   * (no-op when the binding is missing). The Worker decides shadow vs enforce per site.
   */
  aiCheck?: boolean;
  /** Give up on the AI check after this long and keep the rules' decision. Default 4000. */
  aiTimeoutMs?: number;
  debug?: boolean;
  sender?: { name: string; email: string };
}
