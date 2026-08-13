import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeFormBuild,
  parseFormBuild,
  uniqueFieldNames,
} from "../src/shared.ts";
import {
  assessFormSpam,
  auxFieldFilled,
  auxFieldNames,
  stripMetaFields,
} from "../src/server/spam.ts";
import type { SubmitFormOptions } from "../src/server/types.ts";

function mockDb(count = 0) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { c: count };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const baseOptions: SubmitFormOptions = {
  buildEmail: () => ({ subject: "t", html: "<p>t</p>" }),
  phoneLocale: "nanp",
};

test("form_build round-trips tagged aux names", () => {
  const encoded = encodeFormBuild(["confirm_email", "company_fax"]);
  assert.equal(encoded, "1~confirm_email,company_fax");
  assert.deepEqual(parseFormBuild(encoded), ["confirm_email", "company_fax"]);
});

test("form_build ignores injection and empty values", () => {
  assert.deepEqual(parseFormBuild("1~confirm_email,DROP TABLE,x y"), ["confirm_email"]);
  assert.deepEqual(parseFormBuild("1"), []);
  assert.deepEqual(parseFormBuild(undefined), []);
});

test("uniqueFieldNames de-dupes case-insensitively", () => {
  assert.deepEqual(uniqueFieldNames(["confirm_email", "Confirm_Email", "bot-field"]), [
    "confirm_email",
    "bot-field",
  ]);
});

test("aux names merge defaults, extras, and form_build", () => {
  const names = auxFieldNames(
    { form_build: "1~company_fax" },
    ["website"],
  );
  assert.ok(names.includes("confirm_email"));
  assert.ok(names.includes("bot-field"));
  assert.ok(names.includes("website"));
  assert.ok(names.includes("company_fax"));
});

test("filled aux field is detected; blank is not", () => {
  assert.equal(auxFieldFilled({ confirm_email: "bot@x.com" }, ["confirm_email"]), true);
  assert.equal(auxFieldFilled({ confirm_email: "  " }, ["confirm_email"]), false);
});

test("stripMetaFields drops timestamp, form_build, and aux names", () => {
  const clean = stripMetaFields(
    {
      "form-name": "contact",
      submitted_at_client: "1",
      form_build: "1~confirm_email",
      confirm_email: "x",
      name: "Pat",
      source: "https://example.com/",
    },
    ["confirm_email"],
  );
  assert.deepEqual(clean, { name: "Pat", source: "https://example.com/" });
});

test("missing timestamp blocks", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: { "form-name": "contact", message: "clogged toilet" },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["missing-client-timestamp"]);
});

test("too-fast submit blocks", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 500),
      message: "clogged toilet",
    },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(result.decision, "blocked");
  assert.ok(result.reasons.includes("submitted-too-fast"));
});

test("future timestamp blocks as invalid", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() + 86_400_000),
      message: "clogged toilet",
    },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(result.decision, "blocked");
  assert.ok(result.reasons.includes("invalid-client-timestamp"));
});

test("seo audit is a hard block", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 12_000),
      phone: "4155551212",
      message: "I can send you a free, short SEO audit.",
    },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(result.decision, "blocked");
  assert.ok(result.reasons.some((r) => r.startsWith("hard-term:seo audit")));
});

test("real-looking job message is allowed", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 45_000),
      phone: "4156236190",
      message: "Clogged toilet. Need service today.",
    },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.score, 0);
});

test("extraHardTerms from the site are merged", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 12_000),
      phone: "4155551212",
      message: "Please read our special acme pitch.",
    },
    ipAddress: "1.1.1.1",
    options: { ...baseOptions, extraHardTerms: ["acme pitch"] },
    mode: "full",
  });
  assert.equal(result.decision, "blocked");
  assert.ok(result.reasons.some((r) => r.includes("acme pitch")));
});

test("UK locale scores a US-style number", async () => {
  const result = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 12_000),
      phone: "4155551212",
      message: "Need gutters cleaned",
    },
    ipAddress: "1.1.1.1",
    options: { ...baseOptions, phoneLocale: "uk" },
    mode: "full",
  });
  assert.equal(result.decision, "allow");
  assert.ok(result.reasons.includes("non-uk-phone"));
  assert.equal(result.score, 2);
});
