-- 20260504183720_lead_stage_history.sql
-- Adds a dedicated append-only history of every leads.status transition.
-- Without this, "average days from new → qualified" and similar funnel-velocity
-- queries are unrecoverable because leads.status updates in place.
--
-- Mirrors matter_stage_history but at the lead level. Trigger-driven so no
-- code path can mutate leads.status without leaving a history row behind.

CREATE TABLE lead_stage_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_stage_history_firm_id    ON lead_stage_history(firm_id);
CREATE INDEX idx_lead_stage_history_lead_id    ON lead_stage_history(lead_id);
CREATE INDEX idx_lead_stage_history_created_at ON lead_stage_history(created_at DESC);
CREATE INDEX idx_lead_stage_history_firm_lead  ON lead_stage_history(firm_id, lead_id, created_at DESC);

-- Append-only: prevent UPDATE and DELETE
CREATE TRIGGER no_lead_stage_history_update
  BEFORE UPDATE ON lead_stage_history
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_lead_stage_history_delete
  BEFORE DELETE ON lead_stage_history
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- RLS — same pattern as matter_stage_history
ALTER TABLE lead_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm lead history"
  ON lead_stage_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = lead_stage_history.firm_id
      AND firm_users.user_id = auth.uid()
    )
  );

-- Trigger function: log every status transition (and the initial status on insert).
CREATE OR REPLACE FUNCTION log_lead_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO lead_stage_history (firm_id, lead_id, from_status, to_status, actor_id)
    VALUES (NEW.firm_id, NEW.id, NULL, NEW.status, auth.uid());
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO lead_stage_history (firm_id, lead_id, from_status, to_status, actor_id)
    VALUES (NEW.firm_id, NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_log_status_insert
  AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION log_lead_status_transition();

CREATE TRIGGER leads_log_status_update
  AFTER UPDATE OF status ON leads
  FOR EACH ROW EXECUTE FUNCTION log_lead_status_transition();

-- Backfill: every existing lead gets one initial-status row so funnel queries
-- starting today have a complete history. created_at uses the lead's own
-- created_at so historical timestamps are accurate.
INSERT INTO lead_stage_history (firm_id, lead_id, from_status, to_status, created_at)
SELECT firm_id, id, NULL, status, created_at
FROM leads
WHERE NOT EXISTS (
  SELECT 1 FROM lead_stage_history h WHERE h.lead_id = leads.id
);
