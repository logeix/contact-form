interface BindContactFormOptions {
    endpoint?: string;
    thankYouPath?: string;
    /** Verbose console logs. Default true. */
    debug?: boolean;
    errorMessage?: string;
}
declare function bindContactForm(form: HTMLFormElement, options?: BindContactFormOptions): void;
/** Bind every `form[data-lgx-lead]` on the page. */
declare function initContactForms(options?: BindContactFormOptions): void;

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

export { AUX_ATTR, AUX_ROW_ATTR, type BindContactFormOptions, FORM_BUILD_FIELD, LEAD_FORM_ATTR, TIMESTAMP_FIELD, bindContactForm, initContactForms };
