import {
  AUX_ATTR,
  AUX_ROW_ATTR,
  FORM_BUILD_FIELD,
  LEAD_FORM_ATTR,
  SOURCE_FIELD,
  TIMESTAMP_FIELD,
  encodeFormBuild,
} from "../shared";

export interface BindContactFormOptions {
  endpoint?: string;
  thankYouPath?: string;
  /** Verbose console logs. Default true. */
  debug?: boolean;
  errorMessage?: string;
  /** Runs after a successful POST, before the thank-you redirect. */
  onSuccess?: () => void;
}

const HIDE_STYLE =
  "position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;";

function debugLog(enabled: boolean, ...args: unknown[]) {
  if (enabled) console.log("[lgx-contact-form]", ...args);
}

function ensureHiddenInput(form: HTMLFormElement, name: string): HTMLInputElement {
  const existing = form.querySelector(`input[name="${CSS.escape(name)}"]`);
  if (existing instanceof HTMLInputElement) return existing;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  form.appendChild(input);
  return input;
}

function collectAuxNames(form: HTMLFormElement): string[] {
  const names: string[] = [];
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

export function bindContactForm(
  form: HTMLFormElement,
  options: BindContactFormOptions = {},
): void {
  const debug = options.debug !== false;
  const endpoint = options.endpoint || form.getAttribute("action") || "/api/submit-form";
  const thankYouPath = options.thankYouPath || "/thank-you/";
  const errorMessage =
    options.errorMessage || "Something went wrong. Please call us or try again.";

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
    timestamp: timestampInput.value,
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector(".submit-btn") as HTMLButtonElement | null;
    const statusMessage = form.querySelector(".status-message") as HTMLElement | null;
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
        body: body.toString(),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };

      if (response.ok && data.success) {
        debugLog(debug, "ok →", thankYouPath);
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

/** Bind every `form[data-lgx-lead]` on the page. */
export function initContactForms(options: BindContactFormOptions = {}): void {
  const debug = options.debug !== false;
  const selector = `form[${LEAD_FORM_ATTR}]`;
  const forms = document.querySelectorAll(selector);
  debugLog(debug, `init ${forms.length} form(s) matching`, selector);
  forms.forEach((form) => {
    if (form instanceof HTMLFormElement) bindContactForm(form, options);
  });
}
