import { F as FormAttributionMeta, a as FirstTouch } from '../attribution-BGUnjZkw.js';
export { A as ATTRIBUTION_FIELD, C as ClickIdKey, U as UtmKey } from '../attribution-BGUnjZkw.js';

interface BindContactFormOptions {
    endpoint?: string;
    thankYouPath?: string;
    /** Verbose console logs. Default true. */
    debug?: boolean;
    errorMessage?: string;
    /** Runs after a successful POST, before the thank-you redirect. */
    onSuccess?: () => void;
}
declare function bindContactForm(form: HTMLFormElement, options?: BindContactFormOptions): void;
/** Bind every `form[data-lgx-lead]` on the page. */
declare function initContactForms(options?: BindContactFormOptions): void;

/** Persist the first page of this browser tab. Call from the global layout. */
declare function rememberFormFirstTouch(debug?: boolean): FirstTouch;
/** Collect first-touch and submit-page attribution for a form POST. */
declare function collectFormAttribution(debug?: boolean): FormAttributionMeta;
declare function collectFormAttributionJson(debug?: boolean): string;

/**
 * Names used in HTML and POST bodies.
 *
 * Keep these boring. Do not use "honeypot", "trap", "spam", or "bot" —
 * crawlers that read the source skip those.
 *
 * `data-lgx-aux` = auxiliary field (LOGEIX prefix, looks like a form helper).
 * `form_build` = which aux field names were on the page (client → server).
 */
declare const AUX_ATTR = "data-lgx-aux";
declare const AUX_ROW_ATTR = "data-lgx-aux-row";
declare const LEAD_FORM_ATTR = "data-lgx-lead";
declare const FORM_BUILD_FIELD = "form_build";
declare const TIMESTAMP_FIELD = "submitted_at_client";

export { AUX_ATTR, AUX_ROW_ATTR, type BindContactFormOptions, FORM_BUILD_FIELD, FirstTouch, FormAttributionMeta, LEAD_FORM_ATTR, TIMESTAMP_FIELD, bindContactForm, collectFormAttribution, collectFormAttributionJson, initContactForms, rememberFormFirstTouch };
