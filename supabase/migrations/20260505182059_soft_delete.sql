-- 20260505182059_soft_delete.sql
-- Adds soft-delete columns to customer-data tables. Until now, deletions
-- were hard (the "gmail noise" cleanup we ran was a real DELETE that took
-- contacts and conversations with it). Once we have real client data we
-- can't afford that — even a stale row is potentially a discoverable
-- record in legal context.
--
-- This migration only adds the columns + indexes. Read queries are NOT
-- yet updated to filter `deleted_at IS NULL` — that's a separate pass
-- once we have an actual UI delete affordance. No rows are soft-deleted
-- today, so all existing reads continue to behave correctly.
--
-- Convention going forward (also in CLAUDE.md):
--   - Use the `softDelete()` helper in src/lib/soft-delete.ts, never
--     `.delete()` from supabase-js for these tables.
--   - Any new read query MUST filter `deleted_at IS NULL` unless
--     intentionally surfacing soft-deleted rows (e.g. a "trash" view).

ALTER TABLE leads        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contacts     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE matters      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes on the live ("not yet deleted") slice — most queries
-- only care about active rows, so these speed up the common path.
CREATE INDEX IF NOT EXISTS idx_leads_active
  ON leads(firm_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON contacts(firm_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_active
  ON conversations(firm_id, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_active
  ON messages(conversation_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matters_active
  ON matters(firm_id)
  WHERE deleted_at IS NULL;
