-- One row per spam-check call. No message text or contact details: those stay in each
-- site's own form_submissions table (join on site + submitted_at when reviewing).
CREATE TABLE IF NOT EXISTS verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  site TEXT NOT NULL,
  form TEXT NOT NULL,
  submitted_at TEXT,
  mode TEXT NOT NULL,          -- shadow | enforce
  verdict TEXT,                -- allow | review | block (NULL when the check failed)
  p_spam REAL,                 -- sales_pitch + junk probability
  choice TEXT,                 -- Jev's top pick
  probabilities_json TEXT,
  rules_decision TEXT,         -- what the phrase/length rules decided on their own
  rules_reasons_json TEXT,
  message_chars INTEGER,
  latency_ms INTEGER,
  input_tokens INTEGER,
  cost_usd REAL,
  model TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_verdicts_site_created ON verdicts (site, created_at);
