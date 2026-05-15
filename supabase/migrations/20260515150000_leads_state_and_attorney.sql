-- leads.state: two-letter state code (TX/IA/ND/PA/NJ for LFL today).
-- leads.assigned_attorney_name: denormalized human-readable attorney name,
-- driven from firm_config.attorney_of_record_by_jurisdiction. Kept on the
-- lead row so the leads list can render the attorney without joining
-- firm_config for every row.
-- Both columns nullable: pre-jurisdiction leads have no state; leads
-- whose state arrives later (e.g. via SMS conversation) backfill these
-- columns when state is known.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS state                  TEXT,
  ADD COLUMN IF NOT EXISTS assigned_attorney_name TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state) WHERE state IS NOT NULL;
