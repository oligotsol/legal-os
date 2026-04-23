-- seed.sql — Static seed data for LFL (Legacy First Law)
-- Run via: supabase db reset (which applies migrations then seed)
--
-- Auth user creation and firm_users/audit_log wiring require the
-- Supabase Admin API. Use scripts/seed-lfl.ts for the full seed.

-- =============================================================================
-- LFL firm
-- =============================================================================

INSERT INTO firms (id, name, slug, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Legacy First Law',
  'legacy-first-law',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Firm config
-- =============================================================================

INSERT INTO firm_config (firm_id, key, value) VALUES
  ('00000000-0000-0000-0000-000000000001', 'timezone', '"America/Chicago"'),
  ('00000000-0000-0000-0000-000000000001', 'practice_areas', '["estate_planning"]'),
  ('00000000-0000-0000-0000-000000000001', 'ai.classification_model', '"claude-haiku-4-5-20251001"'),
  ('00000000-0000-0000-0000-000000000001', 'ai.conversation_model', '"claude-sonnet-4-6-20250514"'),
  ('00000000-0000-0000-0000-000000000001', 'ai.escalation_model', '"claude-opus-4-6-20250610"')
ON CONFLICT (firm_id, key) DO NOTHING;
