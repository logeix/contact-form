-- D1 baseline schema: form_submissions (contact + other lead forms)
-- Per-site database. Do not share one D1 across clients.
--
--   npx wrangler d1 execute YOUR-FORMS-DB --remote --file=node_modules/@logeix/contact-form/migrations/form_submissions.sql
--   npx wrangler d1 execute YOUR-FORMS-DB --local  --file=node_modules/@logeix/contact-form/migrations/form_submissions.sql

CREATE TABLE IF NOT EXISTS form_submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_name       TEXT    NOT NULL,
  form_name       TEXT    NOT NULL,
  submitted_at    TEXT    NOT NULL,
  ip_address      TEXT    NOT NULL DEFAULT 'unknown',
  user_agent      TEXT    NOT NULL DEFAULT 'unknown',
  form_data       TEXT    NOT NULL,
  email_sent      INTEGER NOT NULL DEFAULT 0,
  email_sent_at   TEXT,
  email_error     TEXT,
  spam_decision   TEXT,
  spam_score      INTEGER,
  spam_reasons    TEXT,
  spam_elapsed_ms INTEGER,
  meta_json       TEXT
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_name ON form_submissions (form_name);
CREATE INDEX IF NOT EXISTS idx_form_submissions_submitted_at ON form_submissions (submitted_at);
CREATE INDEX IF NOT EXISTS idx_form_submissions_ip ON form_submissions (ip_address, form_name, submitted_at);
