-- Add first-touch attribution metadata to an existing form_submissions table.
-- Apply once per site database before deploying the updated form handler.

ALTER TABLE form_submissions ADD COLUMN meta_json TEXT;
