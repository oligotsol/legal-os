-- 20260515154144_sms_compliance.sql
-- TCPA compliance infrastructure for outbound SMS.
--
-- Two append-only tables:
--   sms_opt_outs — phone-number-level opt-out registry. Survives contact
--     deletion / re-import. Authoritative answer to "may we text this
--     number?". Populated by the inbound webhook when ethics scanner
--     detects STOP/UNSUBSCRIBE/etc.
--   sms_sends   — per-send audit log. One row per send attempt (including
--     skips and failures). This is the TCPA defense log.
--
-- Both tables are append-only via triggers + RLS for tenant isolation.

CREATE TABLE sms_opt_outs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  phone_e164      TEXT NOT NULL,
  trigger_keyword TEXT,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (firm, phone). Subsequent STOPs are idempotent.
  UNIQUE (firm_id, phone_e164)
);

CREATE INDEX idx_sms_opt_outs_firm_phone ON sms_opt_outs(firm_id, phone_e164);

ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own firm opt-outs"
  ON sms_opt_outs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = sms_opt_outs.firm_id
      AND firm_users.user_id = auth.uid()
    )
  );

CREATE TRIGGER no_sms_opt_outs_update
  BEFORE UPDATE ON sms_opt_outs
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_sms_opt_outs_delete
  BEFORE DELETE ON sms_opt_outs
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- ---------------------------------------------------------------------------

CREATE TABLE sms_sends (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  blast_id            UUID,  -- not a FK; v0 blasts don't have a typed parent row yet
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  message_id          UUID REFERENCES messages(id) ON DELETE SET NULL,
  phone_e164          TEXT NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN (
    'sent', 'failed', 'skipped_opt_out', 'skipped_consent',
    'skipped_dnc', 'skipped_window', 'dry_run'
  )),
  dialpad_message_id  TEXT,
  error_message       TEXT,
  attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX idx_sms_sends_firm_attempted    ON sms_sends(firm_id, attempted_at DESC);
CREATE INDEX idx_sms_sends_blast             ON sms_sends(blast_id);
CREATE INDEX idx_sms_sends_phone             ON sms_sends(phone_e164, attempted_at DESC);
CREATE INDEX idx_sms_sends_status            ON sms_sends(firm_id, status, attempted_at DESC);

ALTER TABLE sms_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own firm sms sends"
  ON sms_sends FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = sms_sends.firm_id
      AND firm_users.user_id = auth.uid()
    )
  );

CREATE TRIGGER no_sms_sends_update
  BEFORE UPDATE ON sms_sends
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_sms_sends_delete
  BEFORE DELETE ON sms_sends
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();
