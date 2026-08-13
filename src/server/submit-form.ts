/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Pages Function factory — contact (and other) forms → D1 + Brevo.
 *
 * Every submission (including spam) is written to D1.
 * Blocked rows get email suppressed and the reason stored in email_error.
 */

import { FORM_NAME_FIELD } from "../shared";
import { DEFAULT_SENDER, notificationEmails, sendBrevoEmail } from "./brevo";
import { clientIp, jsonResponse, parseFormBody } from "./parse";
import { assessFormSpam, auxFieldFilled, auxFieldNames, stripMetaFields } from "./spam";
import type { SpamAssessment, SubmitFormEnv, SubmitFormOptions } from "./types";

export type { EmailContent, PhoneLocale, SubmitFormOptions } from "./types";

export function createSubmitFormHandler(
  options: SubmitFormOptions,
): PagesFunction<SubmitFormEnv> {
  const debug = options.debug !== false;
  const assessFormNames = options.assessFormNames ?? ["contact"];
  const gateFormNames = options.gateFormNames ?? [];

  function debugLog(...args: unknown[]) {
    if (debug) console.log("[submit-form]", ...args);
  }

  return async (context) => {
    const { request, env } = context;

    try {
      const formData = await parseFormBody(request);
      if (!formData) {
        return jsonResponse({ error: "Unsupported content type" }, 400);
      }

      const formName = formData[FORM_NAME_FIELD] || "unknown";
      const siteName = env.SITE_NAME || "unknown";
      const auxNames = auxFieldNames(formData, options.extraHoneypotFields);
      const honeypotTriggered = auxFieldFilled(formData, auxNames);

      const ipAddress = clientIp(request);
      const userAgent = request.headers.get("User-Agent") || "unknown";
      const submittedAt = new Date().toISOString();

      let spamAssessment: SpamAssessment = { decision: "allow", score: 0, reasons: [] };

      if (honeypotTriggered) {
        spamAssessment = {
          decision: "blocked",
          score: 100,
          reasons: ["honeypot-field-filled"],
        };
        debugLog("aux field filled — logging row without email");
      } else if (assessFormNames.includes(formName)) {
        spamAssessment = await assessFormSpam({
          db: env.DB,
          formData,
          ipAddress,
          options,
          mode: "full",
        });
        if (spamAssessment.decision === "blocked") {
          debugLog("submission blocked (logged):", spamAssessment.reasons.join("; "));
        }
      } else if (gateFormNames.includes(formName)) {
        spamAssessment = await assessFormSpam({
          db: env.DB,
          formData,
          ipAddress,
          options,
          mode: "gates",
        });
        if (spamAssessment.decision === "blocked") {
          debugLog("gated form blocked (logged):", spamAssessment.reasons.join("; "));
        }
      }

      const cleanFormData = stripMetaFields(formData, auxNames);
      const recordSpam =
        honeypotTriggered ||
        assessFormNames.includes(formName) ||
        gateFormNames.includes(formName);

      const insertResult = await env.DB.prepare(
        `INSERT INTO form_submissions
         (site_name, form_name, submitted_at, ip_address, user_agent, form_data, email_sent,
          spam_decision, spam_score, spam_reasons, spam_elapsed_ms)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
        .bind(
          siteName,
          formName,
          submittedAt,
          ipAddress,
          userAgent,
          JSON.stringify(cleanFormData),
          recordSpam ? spamAssessment.decision : null,
          recordSpam ? spamAssessment.score : null,
          recordSpam ? JSON.stringify(spamAssessment.reasons) : null,
          recordSpam ? (spamAssessment.elapsedMs ?? null) : null,
        )
        .run();

      if (!insertResult.success) throw new Error("Database insert failed");

      const submissionId = insertResult.meta.last_row_id as number;

      const emailSuppressedReason =
        spamAssessment.decision === "blocked"
          ? `Suppressed (score ${spamAssessment.score}): ${spamAssessment.reasons.join(", ")}`
          : null;

      if (emailSuppressedReason) {
        await env.DB.prepare(`UPDATE form_submissions SET email_error = ? WHERE id = ?`)
          .bind(emailSuppressedReason, submissionId)
          .run();
        return jsonResponse({ success: true });
      }

      const to = notificationEmails(env.NOTIFICATION_EMAIL, options.fallbackEmails);
      if (!to.length) {
        throw new Error("No notification emails configured");
      }

      try {
        const { subject, html } = options.buildEmail(formName, cleanFormData);
        await sendBrevoEmail(
          env.BREVO_API_KEY,
          to,
          subject,
          html,
          options.sender ?? DEFAULT_SENDER,
        );
        await env.DB.prepare(
          `UPDATE form_submissions SET email_sent = 1, email_sent_at = ? WHERE id = ?`,
        )
          .bind(new Date().toISOString(), submissionId)
          .run();
        debugLog("email sent", { to, submissionId });
      } catch (emailError) {
        console.error("Email send failed:", emailError);
        await env.DB.prepare(`UPDATE form_submissions SET email_error = ? WHERE id = ?`)
          .bind(String(emailError), submissionId)
          .run();
      }

      return jsonResponse({ success: true, submissionId });
    } catch (error) {
      console.error("Form submission error:", error);
      return jsonResponse({ error: "Submission failed", message: String(error) }, 500);
    }
  };
}
