declare const ATTRIBUTION_FIELD = "form_attribution";
declare const ATTRIBUTION_SCHEMA_VERSION: 1;
declare const UTM_KEYS: readonly ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
declare const CLICK_ID_KEYS: readonly ["gclid", "gbraid", "wbraid", "fbclid", "msclkid"];
type UtmKey = (typeof UTM_KEYS)[number];
type ClickIdKey = (typeof CLICK_ID_KEYS)[number];
interface FirstTouch {
    landing_url: string;
    referrer: string | null;
    captured_at: string;
}
interface FormAttributionMeta {
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

export { ATTRIBUTION_FIELD as A, type ClickIdKey as C, type FormAttributionMeta as F, type UtmKey as U, type FirstTouch as a };
