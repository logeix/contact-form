# @logeix/contact-form

Lead form intake for LOGEIX client sites (Astro + Cloudflare Pages + D1 + Brevo).

Stores **every** submission in the site's own D1 `form_submissions` table (including blocked spam). Sends notification email via Brevo only when the spam engine allows it.

This is a sibling of [`@logeix/phone-intent`](https://github.com/logeix/phone-intent). Same install style. **Not** the same package — and **not** a shared database across clients.

## Install

```json
"@logeix/contact-form": "^1.0.0"
```

```bash
npm install
```

Same npm org as [`@logeix/phone-intent`](https://www.npmjs.com/package/@logeix/phone-intent). Public, unlisted-by-search unless you know the name.

GitHub tarball still works if a CI job cannot hit npm:

```json
"@logeix/contact-form": "https://github.com/logeix/contact-form/archive/refs/tags/v1.0.0.tar.gz"
```

## Site setup

### 1. D1 migration

Each site keeps its own D1 (e.g. `asap-plumbing-pros-forms`). Same binding `DB` as phone-intent.

```bash
npx wrangler d1 execute YOUR-FORMS-DB --remote --file=node_modules/@logeix/contact-form/migrations/form_submissions.sql
```

Existing sites that already have `form_submissions` with spam columns do **not** need to re-run this.

### 2. Pages Function

`functions/api/submit-form.ts`:

```ts
import { createSubmitFormHandler } from "@logeix/contact-form/server/submit-form";

export const onRequestPost = createSubmitFormHandler({
  phoneLocale: "nanp", // or "uk"
  fallbackEmails: ["leads@example.com"],
  buildEmail(formName, data) {
    return {
      subject: `[Example Co] New contact — ${data.name || "Unknown"}`,
      html: `<p>${data.message || "—"}</p>`, // site-branded HTML
    };
  },
  // Optional per-site extras (merged with the packaged lists):
  extraHardTerms: ["that one local scam phrase"],
  extraScoreTerms: ["odd sales pitch"],
  extraHoneypotFields: ["company_fax"],
  // gateFormNames: ["instant-quote"], // timing + aux only, no phrase lists
});
```

Requires D1 binding `DB`, vars `SITE_NAME`, `NOTIFICATION_EMAIL`, and secret `BREVO_API_KEY`. Sender is `LOGEIX Agency <noreply@logeix.com>` unless you pass `sender`.

### 3. Form HTML

Tag the form and any decoy fields. **Do not** name fields or attributes `honeypot`, `trap`, `spam`, or `bot` — crawlers skip those.

| Attribute | Where | What it does |
|-----------|--------|----------------|
| `data-lgx-lead` | `<form>` | Client binds timestamp, aux fields, fetch POST |
| `data-lgx-aux` | decoy `<input>` | Hidden; any value → block. Name should look real (`confirm_email`) |
| `data-lgx-aux-row` | optional wrapper | Whole row is clipped off-screen |

```html
<form name="contact" method="POST" action="/api/submit-form" data-lgx-lead>
  <input type="hidden" name="form-name" value="contact" />
  <input type="hidden" name="submitted_at_client" value="" />
  <input type="hidden" name="source" value="" />

  <div data-lgx-aux-row>
    <label for="confirm_email">Please leave this field blank</label>
    <input id="confirm_email" name="confirm_email" type="email" data-lgx-aux />
  </div>

  <!-- real fields: name, phone, email, message, … -->
  <button type="submit" class="submit-btn">Send</button>
  <p class="status-message"></p>
</form>
```

Default aux names the **server** always checks (even without JS): `confirm_email`, `bot-field`. Tagged names are sent in a boring meta field `form_build` so extra decoys work without listing them in the handler.

### 4. Client init

In the page/component script (same pattern as phone-intent):

```astro
<script>
  import { initContactForms } from "@logeix/contact-form/client";
  document.addEventListener("DOMContentLoaded", () => {
    initContactForms({ debug: true });
  });
</script>
```

`debug` defaults to **true** (verbose `[lgx-contact-form]` logs). Set `{ debug: false }` in production if it is noisy.

Keep site-specific JS (service dropdown from `?service=`, scroll-to-book) in the Astro file. Do not also attach a second submit handler.

## Handler options

Hardcoded defaults, then per-site overrides:

| Option | Default | Purpose |
|--------|---------|---------|
| `buildEmail` | required | Subject + HTML for Brevo |
| `phoneLocale` | `"nanp"` | `"uk"` for UK numbers |
| `fallbackEmails` | `[]` | If `NOTIFICATION_EMAIL` is empty |
| `extraHardTerms` | `[]` | Immediate block phrases |
| `extraScoreTerms` | `[]` | +2 each; block at `blockScoreAt` |
| `extraHoneypotFields` | `[]` | Extra POST names treated as aux |
| `assessFormNames` | `["contact"]` | Full scoring |
| `gateFormNames` | `[]` | Timing + aux only |
| `minFillMs` | `3000` | Fill-time gate (negative elapsed also blocks) |
| `blockScoreAt` | `4` | Accumulated score threshold |
| `debug` | `true` | Server `console.log` |
| `sender` | LOGEIX / noreply@logeix.com | Brevo from |

Phrase lists live in `src/server/terms.ts`. Bump the package to change them for every site.

## Spam behaviour

Runs in order. Immediate block → `score: 100`. Blocked rows still insert to D1 and return `{ success: true }` so bots cannot probe.

1. Aux field has a value (`honeypot-field-filled`)
2. Missing / non-numeric / **negative** `submitted_at_client`
3. Elapsed &lt; `minFillMs`
4. URL in `message`
5. Hard phrase
6. Scored phrases, long message, many paragraphs, non-local phone
7. ≥ 3 same IP in 10 min, ≥ 2 same email in 10 min
8. Score ≥ `blockScoreAt`

## Publish (maintainers)

1. Bump `version` in `package.json`
2. `npm test` && `npm run build`
3. Commit, tag (`git tag v1.0.1`), push tag
4. `npm publish --access public`
5. Update client sites to `"@logeix/contact-form": "^1.0.1"`

## Debug

- Client: `{ debug: true }` or default — `[lgx-contact-form]` in the browser console
- Server: Pages Function logs `[submit-form]`
- Query D1: `spam_decision`, `spam_reasons`, `spam_elapsed_ms` on `form_submissions`
