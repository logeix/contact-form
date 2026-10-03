import assert from "node:assert/strict";
import test from "node:test";
import { createSubmitFormHandler } from "../src/server/submit-form.ts";
import type { SubmitFormEnv, SubmitFormOptions } from "../src/server/types.ts";

/** Records every statement; rate-limit counts are always 0. */
function recordingDb() {
  const inserts: unknown[][] = [];
  const updates: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              return { c: 0 };
            },
            async run() {
              if (sql.includes("INSERT")) inserts.push(values);
              else updates.push(sql);
              return { success: true, meta: { last_row_id: inserts.length } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, inserts, updates };
}

/** Swaps global fetch for the duration of `fn` and returns the Brevo calls it saw. */
async function withBrevoStub(fn: () => Promise<void>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

const options: SubmitFormOptions = {
  buildEmail: (formName) => ({ subject: formName, html: "<p>t</p>" }),
  phoneLocale: "nanp",
  gateFormNames: ["instant-quote"],
};

function post(fields: Record<string, string>) {
  return new Request("https://example.com/api/submit-form", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

const realLead = {
  submitted_at_client: String(Date.now() - 20_000),
  name: "Pat Lee",
  phone: "(415) 555-0100",
  message: "Kitchen sink is backing up, can someone come out today?",
};

async function submit(fields: Record<string, string>, handlerOptions = options) {
  const { db, inserts } = recordingDb();
  const env = {
    DB: db,
    BREVO_API_KEY: "test",
    SITE_NAME: "test-site",
    NOTIFICATION_EMAIL: "owner@example.com",
  } satisfies SubmitFormEnv;
  const handler = createSubmitFormHandler(handlerOptions);
  let body: any;
  const brevoCalls = await withBrevoStub(async () => {
    const res = await handler({ request: post(fields), env } as any);
    body = await res.json();
  });
  // INSERT bindings: site, form_name, submitted_at, ip, ua, form_data, decision, score, reasons, elapsed, meta
  const row = inserts[0];
  return {
    body,
    brevoCalls,
    formName: row[1] as string,
    decision: row[6] as string,
    reasons: JSON.parse(row[8] as string) as string[],
  };
}

test("forged form-name is logged as blocked and never emailed", async () => {
  const out = await submit({ ...realLead, "form-name": "contact' AND 1=1 UNION SELECT NULL-- -" });
  assert.deepEqual(out.body, { success: true });
  assert.equal(out.brevoCalls.length, 0);
  assert.equal(out.decision, "blocked");
  assert.deepEqual(out.reasons, ["unknown-form-name"]);
});

test("missing form-name is logged as blocked and never emailed", async () => {
  const out = await submit({ ...realLead });
  assert.equal(out.brevoCalls.length, 0);
  assert.equal(out.formName, "unknown");
  assert.deepEqual(out.reasons, ["unknown-form-name"]);
});

test("unknown form-name is truncated before it is stored", async () => {
  const out = await submit({ ...realLead, "form-name": "x".repeat(500) });
  assert.equal(out.formName.length, 64);
});

test("site with no forms accepts nothing", async () => {
  const out = await submit(
    { ...realLead, "form-name": "contact" },
    { ...options, assessFormNames: [], gateFormNames: [] },
  );
  assert.equal(out.brevoCalls.length, 0);
  assert.deepEqual(out.reasons, ["unknown-form-name"]);
});

test("real contact lead is still emailed", async () => {
  const out = await submit({ ...realLead, "form-name": "contact" });
  assert.equal(out.body.success, true);
  assert.equal(out.decision, "allow");
  assert.deepEqual(out.brevoCalls, ["https://api.brevo.com/v3/smtp/email"]);
});

test("gated form still runs its gates and is emailed when clean", async () => {
  const out = await submit({ ...realLead, "form-name": "instant-quote" });
  assert.equal(out.decision, "allow");
  assert.equal(out.brevoCalls.length, 1);

  const tooFast = await submit({
    ...realLead,
    "form-name": "instant-quote",
    submitted_at_client: String(Date.now()),
  });
  assert.equal(tooFast.brevoCalls.length, 0);
  assert.deepEqual(tooFast.reasons, ["submitted-too-fast"]);
});

test("known form without a page timestamp is blocked", async () => {
  const { submitted_at_client: _omit, ...noTimestamp } = realLead;
  const out = await submit({ ...noTimestamp, "form-name": "contact" });
  assert.equal(out.brevoCalls.length, 0);
  assert.deepEqual(out.reasons, ["missing-client-timestamp"]);
});
