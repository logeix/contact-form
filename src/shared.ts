/**
 * Names used in HTML and POST bodies.
 *
 * Keep these boring. Do not use "honeypot", "trap", "spam", or "bot" —
 * crawlers that read the source skip those.
 *
 * `data-lgx-aux` = auxiliary field (LOGEIX prefix, looks like a form helper).
 * `form_build` = which aux field names were on the page (client → server).
 */

export const AUX_ATTR = "data-lgx-aux";
export const AUX_ROW_ATTR = "data-lgx-aux-row";
export const LEAD_FORM_ATTR = "data-lgx-lead";
export const FORM_BUILD_FIELD = "form_build";
export const TIMESTAMP_FIELD = "submitted_at_client";
export const FORM_NAME_FIELD = "form-name";
export const SOURCE_FIELD = "source";

/**
 * Always treated as aux fields, even if the client never tags them.
 * `website` is the live decoy (plain text — Chrome will not treat it as an email).
 * `confirm_email` is kept so older POSTs still get stripped/blocked.
 */
export const DEFAULT_AUX_FIELDS = ["website", "confirm_email", "bot-field"] as const;

export const FORM_BUILD_VERSION = "1";

export function encodeFormBuild(auxNames: string[]): string {
  const names = uniqueFieldNames(auxNames);
  return names.length ? `${FORM_BUILD_VERSION}~${names.join(",")}` : FORM_BUILD_VERSION;
}

export function parseFormBuild(raw: string | undefined): string[] {
  if (!raw) return [];
  const tilde = raw.indexOf("~");
  if (tilde < 0) return [];
  return uniqueFieldNames(raw.slice(tilde + 1).split(","));
}

export function uniqueFieldNames(names: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
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
