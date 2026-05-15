-- Snapshot the engagement letter template body into the row at generate time.
-- Existing rows have NULL; new rows write the full template HTML so the letter
-- renders identically forever even if firm_config.engagement_letter_template
-- is later edited (immutability for legal documents).

ALTER TABLE engagement_letters
  ADD COLUMN IF NOT EXISTS template_snapshot TEXT;
