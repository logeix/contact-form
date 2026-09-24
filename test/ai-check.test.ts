import assert from "node:assert/strict";
import test from "node:test";
import {
  aiReason,
  applyAiVerdict,
  buildAiCheckPayload,
  requestAiVerdict,
  type AiVerdict,
} from "../src/server/ai-check.ts";
import { assessFormSpam } from "../src/server/spam.ts";
import type { SpamAssessment, SubmitFormOptions } from "../src/server/types.ts";

function mockDb(count = 0) {
  return {
    prepare() {
      return { bind() { return { async first() { return { c: count }; } }; } };
    },
  } as unknown as D1Database;
}

function mockBinding(respond: (body: any) => { status?: number; json: unknown } | Promise<never>) {
  const calls: any[] = [];
  const binding = {
    async fetch(_url: string, init: RequestInit) {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      const out = await respond(body);
      return new Response(JSON.stringify(out.json), { status: out.status ?? 200 });
    },
  } as unknown as Fetcher;
  return { binding, calls };
}

const baseOptions: SubmitFormOptions = {
  buildEmail: () => ({ subject: "t", html: "<p>t</p>" }),
  phoneLocale: "nanp",
};

const contentBlocked: SpamAssessment = {
  decision: "blocked",
  score: 4,
  reasons: ["score-term:best regards", "message-too-long"],
  stage: "content",
};

const verdict = (v: Partial<Extract<AiVerdict, { ok: true }>>): AiVerdict => ({
  ok: true,
  mode: "shadow",
  verdict: "allow",
  pSpam: 0.02,
  choice: "customer",
  ...v,
});

test("gate blocks are marked as gates; content results as content", async () => {
  const gate = await assessFormSpam({
    db: mockDb(),
    formData: { "form-name": "contact", message: "leak" },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(gate.stage, "gate");

  const limited = await assessFormSpam({
    db: mockDb(5),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 20_000),
      message: "Visit www.example.com for SEO services",
    },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(limited.stage, "gate");
  assert.deepEqual(limited.reasons, ["ip-rate-limited"]);

  const content = await assessFormSpam({
    db: mockDb(),
    formData: {
      "form-name": "contact",
      submitted_at_client: String(Date.now() - 20_000),
      message: "Photos: https://example.com/leak",
    },
    ipAddress: "1.1.1.1",
    options: baseOptions,
    mode: "full",
  });
  assert.equal(content.stage, "content");
  assert.equal(content.decision, "blocked");
});

test("shadow verdict only adds a reason", () => {
  const { assessment, subjectPrefix } = applyAiVerdict(
    contentBlocked,
    verdict({ verdict: "allow", pSpam: 0.03 }),
  );
  assert.equal(assessment.decision, "blocked");
  assert.equal(assessment.score, 4);
  assert.equal(assessment.reasons.at(-1), "ai-shadow:allow:customer:0.03");
  assert.equal(subjectPrefix, "");
});

test("enforced allow overrides a content block", () => {
  const { assessment } = applyAiVerdict(contentBlocked, verdict({ mode: "enforce" }));
  assert.equal(assessment.decision, "allow");
  assert.ok(assessment.reasons.includes("message-too-long"));
  assert.equal(assessment.reasons.at(-1), "ai:allow:customer:0.02");
});

test("enforced block blocks an allowed message", () => {
  const allowed: SpamAssessment = { decision: "allow", score: 0, reasons: [], stage: "content" };
  const { assessment } = applyAiVerdict(
    allowed,
    verdict({ mode: "enforce", verdict: "block", pSpam: 0.97, choice: "sales_pitch" }),
  );
  assert.equal(assessment.decision, "blocked");
  assert.equal(assessment.score, 100);
  assert.equal(aiReason(verdict({ mode: "enforce", verdict: "block", pSpam: 0.97, choice: "sales_pitch" })), "ai:block:sales_pitch:0.97");
});

test("enforced review delivers with a subject flag", () => {
  const { assessment, subjectPrefix } = applyAiVerdict(
    contentBlocked,
    verdict({ mode: "enforce", verdict: "review", pSpam: 0.6, choice: "sales_pitch" }),
  );
  assert.equal(assessment.decision, "allow");
  assert.equal(subjectPrefix, "[Possible spam] ");
});

test("a failed check keeps the rules' decision", () => {
  const { assessment } = applyAiVerdict(contentBlocked, { ok: false, error: "timeout" });
  assert.equal(assessment.decision, "blocked");
  assert.equal(assessment.reasons.at(-1), "ai-error:timeout");
});

test("payload leaves out contact details", () => {
  const payload = buildAiCheckPayload({
    site: "asap-plumbing-pros",
    formName: "contact",
    submittedAt: "2026-09-24T00:00:00.000Z",
    formData: {
      name: "Pat Doe",
      email: "pat@example.com",
      phone: "(512) 555-0182",
      service: "Water heater",
      message: "Leaking water heater",
      source: "https://asapplumbingpro.com/contact",
    },
    phoneLocale: "nanp",
    assessment: contentBlocked,
  });
  assert.deepEqual(payload.details, { service: "Water heater" });
  assert.equal(payload.emailDomain, "example.com");
  assert.equal(payload.phone, "valid");
  const text = JSON.stringify(payload);
  assert.ok(!text.includes("Pat Doe") && !text.includes("pat@") && !text.includes("555-0182"));
});

test("requestAiVerdict parses a good answer and rejects bad ones", async () => {
  const good = mockBinding(() => ({
    json: { ok: true, mode: "shadow", verdict: "block", pSpam: 0.91, choice: "sales_pitch" },
  }));
  const ok = await requestAiVerdict(good.binding, { site: "x", message: "m" });
  assert.deepEqual(ok, { ok: true, mode: "shadow", verdict: "block", pSpam: 0.91, choice: "sales_pitch" });
  assert.equal(good.calls.length, 1);

  const failed = mockBinding(() => ({ status: 502, json: { ok: false, error: "missing_key" } }));
  assert.deepEqual(await requestAiVerdict(failed.binding, {}), { ok: false, error: "missing_key" });

  const garbage = mockBinding(() => ({ json: { ok: true, verdict: "maybe" } }));
  assert.equal((await requestAiVerdict(garbage.binding, {})).ok, false);

  const broken = mockBinding(() => Promise.reject(new Error("boom")));
  assert.deepEqual(await requestAiVerdict(broken.binding, {}), { ok: false, error: "unreachable" });
});
