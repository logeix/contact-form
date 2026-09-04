import assert from "node:assert/strict";
import test from "node:test";
import {
  collectFormAttribution,
  rememberFormFirstTouch,
} from "../src/client/attribution.ts";
import {
  sanitizeFormAttribution,
  type FormAttributionMeta,
} from "../src/attribution.ts";
import { isMissingMetaJsonColumn } from "../src/server/submit-form.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function setBrowser(href: string, referrer: string, storage: MemoryStorage) {
  const url = new URL(href);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: url.href,
        origin: url.origin,
        pathname: url.pathname,
        search: url.search,
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { referrer },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
}

test("first touch survives navigation and landing parameters win", () => {
  const storage = new MemoryStorage();
  setBrowser(
    "https://example.com/heating/?utm_source=google&utm_medium=cpc&gclid=abc",
    "https://www.google.com/",
    storage,
  );
  const first = rememberFormFirstTouch(false);

  setBrowser(
    "https://example.com/contact/?utm_source=newsletter",
    "https://example.com/heating/",
    storage,
  );
  const meta = collectFormAttribution(false);

  assert.equal(meta.landing_url, first.landing_url);
  assert.equal(meta.referrer, "https://www.google.com/");
  assert.equal(meta.utm.utm_source, "google");
  assert.equal(meta.utm.utm_medium, "cpc");
  assert.equal(meta.click_ids?.gclid, "abc");
  assert.equal(meta.page_path, "/contact/");
});

test("sanitizer allowlists fields and rejects malformed metadata", () => {
  const input: FormAttributionMeta & { unexpected: string } = {
    schema_version: 99 as 1,
    page_url: "https://example.com/contact/",
    page_path: "/contact/",
    page_search: null,
    landing_url: "https://example.com/",
    first_touch_at: "2026-09-04T00:00:00.000Z",
    referrer: null,
    tap_referrer: null,
    utm: { utm_source: "google" },
    click_ids: { gclid: "abc" },
    unexpected: "discard me",
  };
  const sanitized = sanitizeFormAttribution(JSON.stringify(input));

  assert.equal(sanitized?.schema_version, 1);
  assert.equal(sanitized?.utm.utm_source, "google");
  assert.equal(sanitized?.click_ids?.gclid, "abc");
  assert.equal("unexpected" in (sanitized ?? {}), false);
  assert.equal(sanitizeFormAttribution("{bad json"), null);
});

test("missing meta_json column detection is narrow", () => {
  assert.equal(
    isMissingMetaJsonColumn(new Error("table form_submissions has no column named meta_json")),
    true,
  );
  assert.equal(isMissingMetaJsonColumn(new Error("database unavailable")), false);
});
