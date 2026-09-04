// src/attribution.ts
var ATTRIBUTION_FIELD = "form_attribution";
var ATTRIBUTION_SCHEMA_VERSION = 1;
var UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content"
];
var CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid"
];

// src/shared.ts
var AUX_ATTR = "data-lgx-aux";
var AUX_ROW_ATTR = "data-lgx-aux-row";
var LEAD_FORM_ATTR = "data-lgx-lead";
var FORM_BUILD_FIELD = "form_build";
var TIMESTAMP_FIELD = "submitted_at_client";
var SOURCE_FIELD = "source";
var FORM_BUILD_VERSION = "1";
function encodeFormBuild(auxNames) {
  const names = uniqueFieldNames(auxNames);
  return names.length ? `${FORM_BUILD_VERSION}~${names.join(",")}` : FORM_BUILD_VERSION;
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

// src/client/attribution.ts
var FIRST_TOUCH_KEY = "contact_form_first_touch";
function debugLog(enabled, ...args) {
  if (enabled) console.log("[form-attribution]", ...args);
}
function paramsFromSearch(search) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 256);
  }
  const clickIds = {};
  for (const key of CLICK_ID_KEYS) {
    const value = params.get(key);
    if (value) clickIds[key] = value.slice(0, 256);
  }
  return { utm, clickIds };
}
function paramsFromHref(href) {
  try {
    return paramsFromSearch(new URL(href, window.location.origin).search);
  } catch {
    return { utm: {}, clickIds: {} };
  }
}
function rememberFormFirstTouch(debug = true) {
  const fallback = {
    landing_url: typeof window !== "undefined" ? window.location.href.slice(0, 2048) : "",
    referrer: null,
    captured_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = sessionStorage.getItem(FIRST_TOUCH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.landing_url) return parsed;
    }
  } catch {
  }
  const captured = {
    landing_url: window.location.href.slice(0, 2048),
    referrer: document.referrer ? document.referrer.slice(0, 2048) : null,
    captured_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    sessionStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(captured));
  } catch {
  }
  debugLog(debug, "remembered first touch", captured);
  return captured;
}
function collectFormAttribution(debug = true) {
  if (typeof window === "undefined") {
    return {
      schema_version: ATTRIBUTION_SCHEMA_VERSION,
      page_url: "",
      page_path: "",
      page_search: null,
      landing_url: "",
      first_touch_at: (/* @__PURE__ */ new Date()).toISOString(),
      referrer: null,
      tap_referrer: null,
      utm: {},
      click_ids: null
    };
  }
  const firstTouch = rememberFormFirstTouch(debug);
  const landing = paramsFromHref(firstTouch.landing_url);
  const current = paramsFromSearch(window.location.search);
  const clickIds = { ...current.clickIds, ...landing.clickIds };
  const meta = {
    schema_version: ATTRIBUTION_SCHEMA_VERSION,
    page_url: window.location.href.slice(0, 2048),
    page_path: window.location.pathname.slice(0, 1024),
    page_search: window.location.search ? window.location.search.slice(0, 2048) : null,
    landing_url: firstTouch.landing_url,
    first_touch_at: firstTouch.captured_at,
    referrer: firstTouch.referrer || document.referrer?.slice(0, 2048) || null,
    tap_referrer: document.referrer ? document.referrer.slice(0, 2048) : null,
    utm: { ...current.utm, ...landing.utm },
    click_ids: Object.keys(clickIds).length ? clickIds : null
  };
  debugLog(debug, "collected attribution", meta);
  return meta;
}
function collectFormAttributionJson(debug = true) {
  return JSON.stringify(collectFormAttribution(debug));
}

// src/client/bind.ts
var HIDE_STYLE = "position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;";
function debugLog2(enabled, ...args) {
  if (enabled) console.log("[lgx-contact-form]", ...args);
}
function ensureHiddenInput(form, name) {
  const existing = form.querySelector(`input[name="${CSS.escape(name)}"]`);
  if (existing instanceof HTMLInputElement) return existing;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  form.appendChild(input);
  return input;
}
function collectAuxNames(form) {
  const names = [];
  form.querySelectorAll(`[${AUX_ATTR}]`).forEach((el) => {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    if (!el.name) return;
    names.push(el.name);
    if (el instanceof HTMLInputElement && (el.type === "email" || el.type === "tel")) {
      el.type = "text";
    }
    el.setAttribute("tabindex", "-1");
    el.setAttribute("autocomplete", "lgx-aux");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("readonly", "");
    el.addEventListener("focus", () => {
      el.removeAttribute("readonly");
    });
    el.style.cssText += HIDE_STYLE;
    const row = el.closest(`[${AUX_ROW_ATTR}]`);
    if (row instanceof HTMLElement) {
      row.setAttribute("aria-hidden", "true");
      row.style.cssText += HIDE_STYLE;
    }
  });
  return names;
}
function bindContactForm(form, options = {}) {
  const debug = options.debug !== false;
  const endpoint = options.endpoint || form.getAttribute("action") || "/api/submit-form";
  const thankYouPath = options.thankYouPath || "/thank-you/";
  const errorMessage = options.errorMessage || "Something went wrong. Please call us or try again.";
  const auxNames = collectAuxNames(form);
  rememberFormFirstTouch(debug);
  const timestampInput = ensureHiddenInput(form, TIMESTAMP_FIELD);
  timestampInput.value = Date.now().toString();
  const attributionInput = ensureHiddenInput(form, ATTRIBUTION_FIELD);
  attributionInput.value = collectFormAttributionJson(debug);
  const sourceInput = form.querySelector(`input[name="${SOURCE_FIELD}"]`);
  if (sourceInput instanceof HTMLInputElement) {
    sourceInput.value = window.location.href;
  }
  const buildInput = ensureHiddenInput(form, FORM_BUILD_FIELD);
  buildInput.value = encodeFormBuild(auxNames);
  debugLog2(debug, "bound", {
    endpoint,
    auxNames,
    formBuild: buildInput.value,
    timestamp: timestampInput.value
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector(".submit-btn");
    const statusMessage = form.querySelector(".status-message");
    if (!submitBtn) return;
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    try {
      attributionInput.value = collectFormAttributionJson(debug);
      const formData = new FormData(form);
      const body = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") body.append(key, value);
      });
      debugLog2(debug, "POST", endpoint, Object.fromEntries(body.entries()));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
      const data = await response.json();
      if (response.ok && data.success) {
        debugLog2(debug, "ok \u2192", thankYouPath);
        options.onSuccess?.();
        form.reset();
        window.location.href = thankYouPath;
        return;
      }
      throw new Error(data.error || "Submission failed");
    } catch (err) {
      console.error("[lgx-contact-form]", err);
      if (statusMessage) statusMessage.textContent = errorMessage;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText || "Send message";
    }
  });
}
function initContactForms(options = {}) {
  const debug = options.debug !== false;
  const selector = `form[${LEAD_FORM_ATTR}]`;
  const forms = document.querySelectorAll(selector);
  debugLog2(debug, `init ${forms.length} form(s) matching`, selector);
  forms.forEach((form) => {
    if (form instanceof HTMLFormElement) bindContactForm(form, options);
  });
}

export { ATTRIBUTION_FIELD, AUX_ATTR, AUX_ROW_ATTR, FORM_BUILD_FIELD, LEAD_FORM_ATTR, TIMESTAMP_FIELD, bindContactForm, collectFormAttribution, collectFormAttributionJson, initContactForms, rememberFormFirstTouch };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map