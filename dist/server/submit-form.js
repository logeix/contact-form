// src/shared.ts
var FORM_BUILD_FIELD = "form_build";
var TIMESTAMP_FIELD = "submitted_at_client";
var FORM_NAME_FIELD = "form-name";
var DEFAULT_AUX_FIELDS = ["confirm_email", "bot-field"];
function parseFormBuild(raw) {
  if (!raw) return [];
  const tilde = raw.indexOf("~");
  if (tilde < 0) return [];
  return uniqueFieldNames(raw.slice(tilde + 1).split(","));
}
function uniqueFieldNames(names) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const name of names) {
    const n = name.trim();
    if (!n || !/^[A-Za-z][\w:-]*$/.test(n)) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

// src/server/brevo.ts
var DEFAULT_SENDER = {
  name: "LOGEIX Agency",
  email: "noreply@logeix.com"
};
async function sendBrevoEmail(apiKey, toEmails, subject, htmlContent, sender = DEFAULT_SENDER) {
  const payload = {
    sender,
    to: toEmails.map((email) => ({ email })),
    subject,
    htmlContent
  };
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`Brevo API error: ${res.status} \u2013 ${await res.text()}`);
  }
}
function notificationEmails(envEmail, fallback) {
  const list = (envEmail || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  return fallback?.filter(Boolean) ?? [];
}

// src/server/parse.ts
async function parseFormBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const formData = {};
    new URLSearchParams(text).forEach((value, key) => {
      formData[key] = value;
    });
    return formData;
  }
  if (contentType.includes("application/json")) {
    const raw = await request.json();
    const formData = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
      formData[key] = String(value);
    }
    return formData;
  }
  return null;
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

// src/server/terms.ts
var HARD_SPAM_TERMS = [
  "seo report",
  "seo strategy",
  "seo services",
  "seo specialist",
  "seo expert",
  "seo audit",
  "search engine optimisation",
  "search engine optimization",
  "digital marketing",
  "digital marketing manager",
  "guest post",
  "domain authority",
  "dr 50",
  "backlink",
  "cold outreach",
  "reddit demand",
  "real reddit conversations",
  "monitoring relevant subreddits",
  "warm inbound interest",
  "proposal package",
  "if this is relevant for you",
  "if my previous email didn t go through",
  "if your previous email didn t go through",
  "if you're not interested",
  "if you re not interested",
  'send us "no"',
  "send us no",
  "motivated clients",
  "ethical strategies to draw",
  "social media content",
  "ready to post social media content",
  "7 days of posting content for free",
  "internet marketing warlock",
  "creating money out of thin air",
  "hidden money",
  "trigger points",
  "sell to the affluent",
  "escort application",
  "spellpros com",
  "unsubscribe",
  "trustpilot",
  "fake reviews",
  "purchase reviews",
  "buy reviews",
  "buy google reviews",
  "verified reviews package",
  "reputation repair service",
  "reputation management",
  "manage your online reputation",
  "suppress negative reviews",
  "negative review removal",
  "remove negative reviews",
  "remove bad reviews",
  "selling your business",
  "sell your business",
  "business broker",
  "interested in selling",
  "buying plumbing businesses",
  "buying businesses in your industry",
  "quantity takeoff",
  "stop to opt out",
  "seo opportunities",
  "electrical estimating",
  "project estimator"
];
var SCORE_SPAM_TERMS = [
  "search results",
  "rankings",
  "online presence",
  "visibility on google",
  "search visibility",
  "organic traffic",
  "relevant traffic",
  "convenient time to connect",
  "let me know a convenient time",
  "i recently came across your website",
  "came across your website",
  "came across your business",
  "i noticed your website",
  "pricing and packages",
  "my services and pricing",
  "leads",
  "learn more",
  "book a call",
  "operational systems",
  "day to day workflows",
  "specific examples",
  "high quality email list",
  "free posting content",
  "local business owners",
  "show up online",
  "quote/package/proposal",
  "brand-safe",
  "aged-account",
  "b2b",
  "saas",
  "high-intent threads",
  "google reviews",
  "yelp reviews",
  "tripadvisor reviews",
  "review building",
  "boost your reviews",
  "improve your reviews",
  "more reviews for",
  "positive reviews package",
  "ratings and reviews",
  "reviews for your business",
  "reply yes",
  "vas 4 hire",
  "vas4hire",
  "takeoff services",
  "senior estimator",
  "hope you re doing well",
  "reaching out here",
  "tried emailing but",
  "office side of the business",
  "best regards"
];

// src/server/spam.ts
var DEFAULT_MIN_FILL_MS = 3e3;
var DEFAULT_BLOCK_SCORE = 3;
function auxFieldNames(formData, extra) {
  return uniqueFieldNames([
    ...DEFAULT_AUX_FIELDS,
    ...extra ?? [],
    ...parseFormBuild(formData[FORM_BUILD_FIELD])
  ]);
}
function auxFieldFilled(formData, names) {
  return names.some((name) => Boolean((formData[name] || "").trim()));
}
function stripMetaFields(formData, auxNames) {
  const clean = { ...formData };
  delete clean[FORM_NAME_FIELD];
  delete clean[TIMESTAMP_FIELD];
  delete clean[FORM_BUILD_FIELD];
  for (const name of auxNames) delete clean[name];
  return clean;
}
function normaliseText(input) {
  return input.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function phoneScoreReason(rawPhone, locale) {
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
async function assessFormSpam(params) {
  const { db, formData, ipAddress, options, mode } = params;
  const reasons = [];
  let score = 0;
  const minFillMs = options.minFillMs ?? DEFAULT_MIN_FILL_MS;
  const blockScoreAt = options.blockScoreAt ?? DEFAULT_BLOCK_SCORE;
  const locale = options.phoneLocale ?? "nanp";
  const clientTimestamp = Number(formData[TIMESTAMP_FIELD] || 0);
  let elapsedMs;
  if (Number.isFinite(clientTimestamp) && clientTimestamp > 0) {
    elapsedMs = Date.now() - clientTimestamp;
    if (elapsedMs < 0 || elapsedMs < minFillMs) {
      reasons.push(elapsedMs < 0 ? "invalid-client-timestamp" : "submitted-too-fast");
      return { decision: "blocked", score: 100, reasons, elapsedMs };
    }
  } else {
    reasons.push("missing-client-timestamp");
    return { decision: "blocked", score: 100, reasons, elapsedMs };
  }
  if (mode === "gates") {
    return { decision: "allow", score: 0, reasons, elapsedMs };
  }
  if (/(https?:\/\/|www\.)/i.test(formData.message || "")) {
    reasons.push("contains-link");
    return { decision: "blocked", score: 100, reasons, elapsedMs };
  }
  const msg = normaliseText(formData.message || "");
  const hardTerms = [...HARD_SPAM_TERMS, ...options.extraHardTerms ?? []];
  for (const term of hardTerms) {
    if (msg.includes(normaliseText(term))) {
      reasons.push(`hard-term:${term}`);
      return { decision: "blocked", score: 100, reasons, elapsedMs };
    }
  }
  const scoreTerms = [...SCORE_SPAM_TERMS, ...options.extraScoreTerms ?? []];
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
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1e3).toISOString();
  const formName = formData[FORM_NAME_FIELD] || "contact";
  const ipRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM form_submissions
       WHERE form_name = ? AND submitted_at >= ? AND ip_address = ?`
  ).bind(formName, tenMinutesAgo, ipAddress).first();
  if (Number(ipRow?.c || 0) >= 3) {
    reasons.push("ip-rate-limited");
    return { decision: "blocked", score: 100, reasons, elapsedMs };
  }
  const email = (formData.email || "").trim().toLowerCase();
  if (email) {
    const emailRow = await db.prepare(
      `SELECT COUNT(*) AS c FROM form_submissions
         WHERE form_name = ? AND submitted_at >= ?
           AND json_extract(form_data, '$.email') = ?`
    ).bind(formName, tenMinutesAgo, email).first();
    if (Number(emailRow?.c || 0) >= 2) {
      reasons.push("email-rate-limited");
      return { decision: "blocked", score: 100, reasons, elapsedMs };
    }
  }
  if (score >= blockScoreAt) {
    return { decision: "blocked", score, reasons, elapsedMs };
  }
  return { decision: "allow", score, reasons, elapsedMs };
}

// src/server/submit-form.ts
function createSubmitFormHandler(options) {
  const debug = options.debug !== false;
  const assessFormNames = options.assessFormNames ?? ["contact"];
  const gateFormNames = options.gateFormNames ?? [];
  function debugLog(...args) {
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
      const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
      let spamAssessment = { decision: "allow", score: 0, reasons: [] };
      if (honeypotTriggered) {
        spamAssessment = {
          decision: "blocked",
          score: 100,
          reasons: ["honeypot-field-filled"]
        };
        debugLog("aux field filled \u2014 logging row without email");
      } else if (assessFormNames.includes(formName)) {
        spamAssessment = await assessFormSpam({
          db: env.DB,
          formData,
          ipAddress,
          options,
          mode: "full"
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
          mode: "gates"
        });
        if (spamAssessment.decision === "blocked") {
          debugLog("gated form blocked (logged):", spamAssessment.reasons.join("; "));
        }
      }
      const cleanFormData = stripMetaFields(formData, auxNames);
      const recordSpam = honeypotTriggered || assessFormNames.includes(formName) || gateFormNames.includes(formName);
      const insertResult = await env.DB.prepare(
        `INSERT INTO form_submissions
         (site_name, form_name, submitted_at, ip_address, user_agent, form_data, email_sent,
          spam_decision, spam_score, spam_reasons, spam_elapsed_ms)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      ).bind(
        siteName,
        formName,
        submittedAt,
        ipAddress,
        userAgent,
        JSON.stringify(cleanFormData),
        recordSpam ? spamAssessment.decision : null,
        recordSpam ? spamAssessment.score : null,
        recordSpam ? JSON.stringify(spamAssessment.reasons) : null,
        recordSpam ? spamAssessment.elapsedMs ?? null : null
      ).run();
      if (!insertResult.success) throw new Error("Database insert failed");
      const submissionId = insertResult.meta.last_row_id;
      const emailSuppressedReason = spamAssessment.decision === "blocked" ? `Suppressed (score ${spamAssessment.score}): ${spamAssessment.reasons.join(", ")}` : null;
      if (emailSuppressedReason) {
        await env.DB.prepare(`UPDATE form_submissions SET email_error = ? WHERE id = ?`).bind(emailSuppressedReason, submissionId).run();
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
          options.sender ?? DEFAULT_SENDER
        );
        await env.DB.prepare(
          `UPDATE form_submissions SET email_sent = 1, email_sent_at = ? WHERE id = ?`
        ).bind((/* @__PURE__ */ new Date()).toISOString(), submissionId).run();
        debugLog("email sent", { to, submissionId });
      } catch (emailError) {
        console.error("Email send failed:", emailError);
        await env.DB.prepare(`UPDATE form_submissions SET email_error = ? WHERE id = ?`).bind(String(emailError), submissionId).run();
      }
      return jsonResponse({ success: true, submissionId });
    } catch (error) {
      console.error("Form submission error:", error);
      return jsonResponse({ error: "Submission failed", message: String(error) }, 500);
    }
  };
}

export { createSubmitFormHandler };
//# sourceMappingURL=submit-form.js.map
//# sourceMappingURL=submit-form.js.map