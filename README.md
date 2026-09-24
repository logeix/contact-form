# @logeix/contact-form

Lead form intake for LOGEIX client sites (Astro + Cloudflare Pages + D1 + Brevo).

Stores **every** submission in the site's own D1 `form_submissions` table (including blocked spam). Sends notification email via Brevo only when the spam engine allows it.

This is a sibling of [`@logeix/phone-intent`](https://github.com/logeix/phone-intent). Same install style. **Not** the same package — and **not** a shared database across clients.

## Install

```json
"@logeix/contact-form": "^1.2.0"
```

```bash
npm install
```

Same npm org as [`@logeix/phone-intent`](https://www.npmjs.com/package/@logeix/phone-intent). Public, unlisted-by-search unless you know the name.

GitHub tarball still works if a CI job cannot hit npm:

```json
"@logeix/contact-form": "https://github.com/logeix/contact-form/archive/refs/tags/v1.2.0.tar.gz"
```

## Site setup

### 1. D1 migration

Each site keeps its own D1 (e.g. `asap-plumbing-pros-forms`). Same binding `DB` as phone-intent.

```bash
npx wrangler d1 execute YOUR-FORMS-DB --remote --file=node_modules/@logeix/contact-form/migrations/form_submissions.sql
```

Existing sites must apply the additive attribution migration once before upgrading:

```bash
npx wrangler d1 execute YOUR-FORMS-DB --remote --file=node_modules/@logeix/contact-form/migrations/form_submissions_v2_meta_json.sql
```

The handler safely falls back to storing the lead without attribution if this
column is temporarily missing.

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
| `data-lgx-aux` | decoy `<input>` | Hidden; any value → block. Use `type="text"` named `website` — **not** email |
| `data-lgx-aux-row` | optional wrapper | Whole row is clipped off-screen |

Put the decoy **after** the real fields so Chrome autofill hits name/phone/email first. Do not use `type="email"` or a name containing `email` — browsers dump the profile address into the first email-ish control and leave the visible one empty.

```html
<form name="contact" method="POST" action="/api/submit-form" data-lgx-lead>
  <input type="hidden" name="form-name" value="contact" />
  <input type="hidden" name="submitted_at_client" value="" />
  <input type="hidden" name="source" value="" />

  <!-- real fields: name, phone, email, message, … -->

  <div data-lgx-aux-row>
    <label>Website
      <input name="website" type="text" data-lgx-aux autocomplete="lgx-aux" tabindex="-1" readonly />
    </label>
  </div>

  <button type="submit" class="submit-btn">Send</button>
  <p class="status-message"></p>
</form>
```

The client bind forces `autocomplete="lgx-aux"` (Chrome ignores `off` on contact fields) and `readonly` until focus, so profile autofill skips the decoy. Bots that POST HTML still send a value.

Default aux names the **server** always checks (even without JS): `website`, `confirm_email` (legacy), `bot-field`. Tagged names are sent in a boring meta field `form_build` so extra decoys work without listing them in the handler.

### 4. Client init

Capture first touch from the global layout so navigation before opening a form
does not lose the original referrer or campaign:

```astro
<script>
  import { rememberFormFirstTouch } from "@logeix/contact-form/client";
  rememberFormFirstTouch(true);
</script>
```

Then bind forms in the page/component script:

```astro
<script>
  import { initContactForms } from "@logeix/contact-form/client";
  document.addEventListener("DOMContentLoaded", () => {
    initContactForms({ debug: true });
  });
</script>
```

`debug` defaults to **true** (verbose `[lgx-contact-form]` logs). Set `{ debug: false }` in production if it is noisy.

Optional `onSuccess` runs after a successful POST, before the thank-you redirect (e.g. dispatch a conversion event).

Keep site-specific JS (service dropdown from `?service=`, scroll-to-book) in the Astro file. Do not also attach a second submit handler.

Custom JavaScript or React forms that post directly to the endpoint should add
the reserved field through the package helper:

```ts
import { ATTRIBUTION_FIELD, collectFormAttributionJson } from "@logeix/contact-form/client";

body.append(ATTRIBUTION_FIELD, collectFormAttributionJson(true));
```

Attribution is stored separately in `form_submissions.meta_json`; it is not
included in customer form data or notification email fields.

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
| `blockScoreAt` | `3` | Accumulated score threshold |
| `debug` | `true` | Server `console.log` |
| `sender` | LOGEIX / noreply@logeix.com | Brevo from |
| `aiCheck` | `true` | Ask the `SPAM_CHECK` Worker (no-op without the binding) |
| `aiTimeoutMs` | `4000` | Keep the rules' decision if the AI check is slower |

Phrase lists live in `src/server/terms.ts`. Bump the package to change them for every site.

## Spam behaviour

Runs in order. Immediate block → `score: 100`. Blocked rows still insert to D1 and return `{ success: true }` so bots cannot probe.

Bot gates (plain code, always final):

1. Aux field has a value (`honeypot-field-filled`)
2. Missing / non-numeric / **negative** `submitted_at_client`
3. Elapsed &lt; `minFillMs`
4. ≥ 3 same IP in 10 min, ≥ 2 same email in 10 min

Content rules (the AI check can overrule these when a site is enforced):

5. URL in `message`
6. Hard phrase
7. Scored phrases, long message, many paragraphs, non-local phone
8. Score ≥ `blockScoreAt`

## AI spam check (optional)

Messages that pass the bot gates can be sent to the central `lgx-spam-check` Worker (code in [`worker/`](./worker), deployed on the LOGEIX Cloudflare account). It holds the OpenRouter key and asks TypeSafe's Jev model whether the message is a customer, a sales pitch, another real contact, or junk. The key never touches this package or the client site.

Add a service binding to the site's `wrangler.toml` (same Cloudflare account as the Worker) and redeploy:

```toml
[[services]]
binding = "SPAM_CHECK"
service = "lgx-spam-check"
```

The Worker decides per site what happens with its verdict:

- **shadow** (default): the rules still decide; the verdict is only recorded, e.g. `ai-shadow:block:sales_pitch:0.97` in `spam_reasons`.
- **enforce** (`MODE=enforce`, or the site listed in `ENFORCE_SITES`): the verdict replaces the content rules. `block` suppresses the email, `review` delivers it with a `[Possible spam] ` subject prefix, `allow` delivers it even if the rules would have blocked it.

If the Worker errors or times out, the rules' decision stands and `ai-error:<code>` is recorded. Only the message, short non-contact fields (for example `service`), the email domain, and whether the phone number looks valid are sent. Names, email addresses, and phone numbers stay on the site. The Worker's own D1 logs every verdict without message text.

## Publish (maintainers)

1. Bump `version` in `package.json`
2. `npm test` && `npm run build` (commit the rebuilt `dist/` too, for tarball installs)
3. Commit, tag (`git tag v1.2.0`), push the commit and the tag
4. GitHub Actions (`.github/workflows/publish.yml`) publishes the tag to npm through trusted publishing; no token needed. It can also be run by hand from the Actions tab, and it skips versions npm already has.
5. Update client sites to `"@logeix/contact-form": "^1.2.0"`

Worker changes deploy separately: `cd worker && npx wrangler deploy` (migrations: `npx wrangler d1 migrations apply lgx-spam-check --remote`).

## Debug

- Client: `{ debug: true }` or default — `[lgx-contact-form]` in the browser console
- Server: Pages Function logs `[submit-form]`
- Query D1: `spam_decision`, `spam_reasons`, `spam_elapsed_ms`, and `meta_json` on `form_submissions`
