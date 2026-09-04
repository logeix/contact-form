export const ATTRIBUTION_FIELD = "form_attribution";
export const ATTRIBUTION_SCHEMA_VERSION = 1 as const;

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export const CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];

export interface FirstTouch {
  landing_url: string;
  referrer: string | null;
  captured_at: string;
}

export interface FormAttributionMeta {
  schema_version: typeof ATTRIBUTION_SCHEMA_VERSION;
  page_url: string;
  page_path: string;
  page_search: string | null;
  landing_url: string;
  first_touch_at: string;
  referrer: string | null;
  tap_referrer: string | null;
  utm: Partial<Record<UtmKey, string>>;
  click_ids: Partial<Record<ClickIdKey, string>> | null;
}

const URL_MAX = 2048;
const PATH_MAX = 1024;
const PARAM_MAX = 256;
const DATE_MAX = 64;

function cappedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function pickParams<K extends string>(
  value: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const text = cappedString(source[key], PARAM_MAX);
    if (text) result[key] = text;
  }
  return result;
}

/** Parse and allowlist client-provided attribution before storing it in D1. */
export function sanitizeFormAttribution(
  raw: string | null | undefined,
): FormAttributionMeta | null {
  if (!raw || raw.length > 16_384) return null;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const pageUrl = cappedString(value.page_url, URL_MAX);
    const pagePath = cappedString(value.page_path, PATH_MAX);
    const landingUrl = cappedString(value.landing_url, URL_MAX);
    const firstTouchAt = cappedString(value.first_touch_at, DATE_MAX);
    if (!pageUrl || !pagePath || !landingUrl || !firstTouchAt) return null;

    const clickIds = pickParams(value.click_ids, CLICK_ID_KEYS);
    return {
      schema_version: ATTRIBUTION_SCHEMA_VERSION,
      page_url: pageUrl,
      page_path: pagePath,
      page_search: cappedString(value.page_search, URL_MAX),
      landing_url: landingUrl,
      first_touch_at: firstTouchAt,
      referrer: cappedString(value.referrer, URL_MAX),
      tap_referrer: cappedString(value.tap_referrer, URL_MAX),
      utm: pickParams(value.utm, UTM_KEYS),
      click_ids: Object.keys(clickIds).length ? clickIds : null,
    };
  } catch {
    return null;
  }
}
