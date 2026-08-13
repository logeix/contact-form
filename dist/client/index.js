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

// src/client/bind.ts
var HIDE_STYLE = "position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;";
function debugLog(enabled, ...args) {
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
    el.setAttribute("tabindex", "-1");
    el.setAttribute("autocomplete", "off");
    el.setAttribute("aria-hidden", "true");
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
  const timestampInput = ensureHiddenInput(form, TIMESTAMP_FIELD);
  timestampInput.value = Date.now().toString();
  const sourceInput = form.querySelector(`input[name="${SOURCE_FIELD}"]`);
  if (sourceInput instanceof HTMLInputElement) {
    sourceInput.value = window.location.href;
  }
  const buildInput = ensureHiddenInput(form, FORM_BUILD_FIELD);
  buildInput.value = encodeFormBuild(auxNames);
  debugLog(debug, "bound", {
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
      const formData = new FormData(form);
      const body = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") body.append(key, value);
      });
      debugLog(debug, "POST", endpoint, Object.fromEntries(body.entries()));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
      const data = await response.json();
      if (response.ok && data.success) {
        debugLog(debug, "ok \u2192", thankYouPath);
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
  debugLog(debug, `init ${forms.length} form(s) matching`, selector);
  forms.forEach((form) => {
    if (form instanceof HTMLFormElement) bindContactForm(form, options);
  });
}

export { AUX_ATTR, AUX_ROW_ATTR, FORM_BUILD_FIELD, LEAD_FORM_ATTR, TIMESTAMP_FIELD, bindContactForm, initContactForms };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map