-- 20260505171629_vertical_action_types.sql
-- Replaces the hardcoded approval_queue.action_type CHECK constraint with a
-- vertical-driven lookup table. Today the constraint is law-shaped
-- ('engagement_letter' is a law term). A roofing firm needs different action
-- types ('quote', 'contract', 'change_order'). Without this, onboarding a
-- non-legal vertical requires a code change — violates the multi-vertical
-- architecture rule in CLAUDE.md.
--
-- Design:
--   vertical_action_types is a (vertical, action_type) lookup with metadata:
--     - label                — human-readable display name
--     - mandatory_review     — if true, attorney/owner approval is hard-gated
--                              regardless of firm_config.approval_mode (the
--                              non-negotiable approval-gate rule from CLAUDE.md)
--   approval_queue's CHECK constraint is dropped and replaced with a BEFORE
--   INSERT trigger that validates the (firm.vertical, action_type) pair
--   exists in the lookup. This pushes the rule into data, not schema.

CREATE TABLE IF NOT EXISTS vertical_action_types (
  vertical          TEXT NOT NULL,
  action_type       TEXT NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT,
  mandatory_review  BOOLEAN NOT NULL DEFAULT false,
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vertical, action_type)
);

-- Seed the legal vertical with the action types that already existed.
-- Mandatory_review preserves CLAUDE.md non-negotiable #3: fee_quote,
-- engagement_letter, invoice always require attorney sign-off.
INSERT INTO vertical_action_types (vertical, action_type, label, description, mandatory_review, display_order)
VALUES
  ('legal', 'fee_quote',         'Fee Quote',         'Pricing offer to a client',                            true,  10),
  ('legal', 'engagement_letter', 'Engagement Letter', 'Formal client engagement contract',                    true,  20),
  ('legal', 'invoice',           'Invoice',           'Payment request to a client',                          true,  30),
  ('legal', 'message',           'Message',           'Outbound SMS or email reply',                          false, 40),
  ('legal', 'other',             'Other',             'Catch-all for ad-hoc decisions',                       false, 50)
ON CONFLICT (vertical, action_type) DO NOTHING;

-- Stub seed entries for future verticals. Not enabled by default — these are
-- here as a template for what onboarding looks like. Comment back in when a
-- non-legal tenant lands.
--
-- INSERT INTO vertical_action_types (vertical, action_type, label, mandatory_review, display_order) VALUES
--   ('roofing', 'quote',        'Quote',        true,  10),
--   ('roofing', 'contract',     'Contract',     true,  20),
--   ('roofing', 'change_order', 'Change Order', true,  30),
--   ('roofing', 'invoice',      'Invoice',      true,  40),
--   ('roofing', 'message',      'Message',      false, 50),
--   ('roofing', 'other',        'Other',        false, 60);

-- Drop the hardcoded CHECK constraint on approval_queue.
ALTER TABLE approval_queue DROP CONSTRAINT IF EXISTS approval_queue_action_type_check;

-- Validation trigger: every approval_queue insert/update must reference a
-- (vertical, action_type) pair that exists in vertical_action_types.
CREATE OR REPLACE FUNCTION validate_approval_action_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  firm_vertical TEXT;
BEGIN
  SELECT vertical INTO firm_vertical FROM firms WHERE id = NEW.firm_id;
  IF firm_vertical IS NULL THEN
    RAISE EXCEPTION 'firm % has no vertical set', NEW.firm_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vertical_action_types
    WHERE vertical = firm_vertical AND action_type = NEW.action_type
  ) THEN
    RAISE EXCEPTION
      'action_type "%" is not allowed for vertical "%". Add it to vertical_action_types or pick an existing one.',
      NEW.action_type, firm_vertical;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_queue_validate_action_type ON approval_queue;
CREATE TRIGGER approval_queue_validate_action_type
  BEFORE INSERT OR UPDATE OF action_type ON approval_queue
  FOR EACH ROW EXECUTE FUNCTION validate_approval_action_type();

-- RLS — the lookup is global metadata, readable to all authenticated users.
ALTER TABLE vertical_action_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vertical_action_types readable to authenticated"
  ON vertical_action_types FOR SELECT
  USING (auth.role() = 'authenticated');
