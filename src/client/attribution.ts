import {
  ATTRIBUTION_SCHEMA_VERSION,
  CLICK_ID_KEYS,
  UTM_KEYS,
  type ClickIdKey,
  type FirstTouch,
  type FormAttributionMeta,
  type UtmKey,
} from "../attribution";

const FIRST_TOUCH_KEY = "contact_form_first_touch";

function debugLog(enabled: boolean, ...args: unknown[]) {
  if (enabled) console.log("[form-attribution]", ...args);
}

function paramsFromSearch(search: string): {
  utm: Partial<Record<UtmKey, string>>;
  clickIds: Partial<Record<ClickIdKey, string>>;
} {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const utm: Partial<Record<UtmKey, string>> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 256);
  }
  const clickIds: Partial<Record<ClickIdKey, string>> = {};
  for (const key of CLICK_ID_KEYS) {
    const value = params.get(key);
    if (value) clickIds[key] = value.slice(0, 256);
  }
  return { utm, clickIds };
}

function paramsFromHref(href: string): ReturnType<typeof paramsFromSearch> {
  try {
    return paramsFromSearch(new URL(href, window.location.origin).search);
  } catch {
    return { utm: {}, clickIds: {} };
  }
}

/** Persist the first page of this browser tab. Call from the global layout. */
export function rememberFormFirstTouch(debug = true): FirstTouch {
  const fallback: FirstTouch = {
    landing_url: typeof window !== "undefined" ? window.location.href.slice(0, 2048) : "",
    referrer: null,
    captured_at: new Date().toISOString(),
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = sessionStorage.getItem(FIRST_TOUCH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FirstTouch;
      if (parsed?.landing_url) return parsed;
    }
  } catch {
    // Private mode, quota, or malformed prior value: capture a fresh value.
  }

  const captured: FirstTouch = {
    landing_url: window.location.href.slice(0, 2048),
    referrer: document.referrer ? document.referrer.slice(0, 2048) : null,
    captured_at: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(captured));
  } catch {
    // Attribution is best effort and must never block a form.
  }
  debugLog(debug, "remembered first touch", captured);
  return captured;
}

/** Collect first-touch and submit-page attribution for a form POST. */
export function collectFormAttribution(debug = true): FormAttributionMeta {
  if (typeof window === "undefined") {
    return {
      schema_version: ATTRIBUTION_SCHEMA_VERSION,
      page_url: "",
      page_path: "",
      page_search: null,
      landing_url: "",
      first_touch_at: new Date().toISOString(),
      referrer: null,
      tap_referrer: null,
      utm: {},
      click_ids: null,
    };
  }

  const firstTouch = rememberFormFirstTouch(debug);
  const landing = paramsFromHref(firstTouch.landing_url);
  const current = paramsFromSearch(window.location.search);
  const clickIds = { ...current.clickIds, ...landing.clickIds };
  const meta: FormAttributionMeta = {
    schema_version: ATTRIBUTION_SCHEMA_VERSION,
    page_url: window.location.href.slice(0, 2048),
    page_path: window.location.pathname.slice(0, 1024),
    page_search: window.location.search ? window.location.search.slice(0, 2048) : null,
    landing_url: firstTouch.landing_url,
    first_touch_at: firstTouch.captured_at,
    referrer: firstTouch.referrer || document.referrer?.slice(0, 2048) || null,
    tap_referrer: document.referrer ? document.referrer.slice(0, 2048) : null,
    utm: { ...current.utm, ...landing.utm },
    click_ids: Object.keys(clickIds).length ? clickIds : null,
  };
  debugLog(debug, "collected attribution", meta);
  return meta;
}

export function collectFormAttributionJson(debug = true): string {
  return JSON.stringify(collectFormAttribution(debug));
}
