-- 00004_approvals_fees_invoices.sql
-- Approval workflow, fee quotes, engagement letters, invoices,
-- jurisdictions, integration sync state, drip engine
-- 10 tables, RLS policies, immutability triggers

-- =============================================================================
-- 1. Tables (ordered by FK dependencies)
-- =============================================================================

-- 1.1 approval_queue — anything awaiting attorney decision
CREATE TABLE approval_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  action_type   TEXT NOT NULL
                  CHECK (action_type IN (
                    'fee_quote', 'engagement_letter', 'invoice',
                    'message', 'other'
                  )),
  priority      INTEGER NOT NULL DEFAULT 0,
  sla_deadline  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER approval_queue_updated_at
  BEFORE UPDATE ON approval_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.2 approvals — immutable decision records
CREATE TABLE approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  queue_item_id    UUID NOT NULL REFERENCES approval_queue(id) ON DELETE CASCADE,
  decision         TEXT NOT NULL
                     CHECK (decision IN ('approved', 'rejected', 'edited_and_approved')),
  decided_by       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_content JSONB,
  edited_content   JSONB,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER no_approvals_update
  BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_approvals_delete
  BEFORE DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- 1.3 jurisdictions — per-firm state-level legal metadata
CREATE TABLE jurisdictions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  state_code                TEXT NOT NULL,
  state_name                TEXT NOT NULL,
  iolta_rule                TEXT,
  iolta_account_type        TEXT
                              CHECK (iolta_account_type IN ('trust', 'operating')),
  earning_method            TEXT
                              CHECK (earning_method IN ('milestone', 'earned_upon_receipt')),
  milestone_split           JSONB,  -- e.g. [33, 33, 34] for TX/IA
  requires_informed_consent BOOLEAN NOT NULL DEFAULT false,
  attorney_name             TEXT,
  attorney_email            TEXT,
  notes                     TEXT,
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, state_code)
);

CREATE TRIGGER jurisdictions_updated_at
  BEFORE UPDATE ON jurisdictions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.4 fee_quotes — per-matter quote with negotiation trail
CREATE TABLE fee_quotes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                  UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id                UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  contact_id               UUID REFERENCES contacts(id) ON DELETE SET NULL,
  line_items               JSONB NOT NULL DEFAULT '[]',
  subtotal                 NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
  bundle_discount          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  engagement_tier_discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_quoted_fee         NUMERIC(10, 2) NOT NULL CHECK (total_quoted_fee >= 0),
  floor_total              NUMERIC(10, 2) NOT NULL CHECK (floor_total >= 0),
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN (
                               'draft', 'pending_approval', 'approved',
                               'sent', 'accepted', 'rejected',
                               'expired', 'superseded'
                             )),
  negotiation_notes        TEXT,
  approved_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at              TIMESTAMPTZ,
  sent_at                  TIMESTAMPTZ,
  accepted_at              TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  metadata                 JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER fee_quotes_updated_at
  BEFORE UPDATE ON fee_quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.5 engagement_letters — template, PDF, e-sign tracking
CREATE TABLE engagement_letters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id           UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  fee_quote_id        UUID REFERENCES fee_quotes(id) ON DELETE SET NULL,
  jurisdiction_id     UUID REFERENCES jurisdictions(id) ON DELETE SET NULL,
  template_key        TEXT,
  variables           JSONB NOT NULL DEFAULT '{}',
  pdf_storage_path    TEXT,
  e_sign_provider     TEXT,
  e_sign_envelope_id  TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                          'draft', 'pending_approval', 'approved',
                          'sent', 'viewed', 'signed', 'declined', 'expired'
                        )),
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  signed_at           TIMESTAMPTZ,
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER engagement_letters_updated_at
  BEFORE UPDATE ON engagement_letters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.6 invoices — payment tracking
CREATE TABLE invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id             UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  fee_quote_id          UUID REFERENCES fee_quotes(id) ON DELETE SET NULL,
  engagement_letter_id  UUID REFERENCES engagement_letters(id) ON DELETE SET NULL,
  amount                NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  payment_provider      TEXT,
  payment_provider_id   TEXT,
  payment_link          TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN (
                            'draft', 'pending_approval', 'approved',
                            'sent', 'paid', 'overdue',
                            'cancelled', 'refunded'
                          )),
  approved_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  metadata              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.7 integration_sync_state — sync cursors for pollers
CREATE TABLE integration_sync_state (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  sync_type              TEXT NOT NULL,
  cursor                 TEXT,
  last_polled_at         TIMESTAMPTZ,
  last_successful_at     TIMESTAMPTZ,
  error_count            INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  metadata               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(integration_account_id, sync_type)
);

CREATE TRIGGER integration_sync_state_updated_at
  BEFORE UPDATE ON integration_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.8 drip_campaigns — campaign definitions
CREATE TABLE drip_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  description      TEXT,
  trigger_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  trigger_event    TEXT NOT NULL
                     CHECK (trigger_event IN (
                       'stage_entered', 'lead_created', 'quote_sent',
                       'engagement_sent', 'payment_received', 'manual'
                     )),
  active           BOOLEAN NOT NULL DEFAULT true,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, slug)
);

CREATE TRIGGER drip_campaigns_updated_at
  BEFORE UPDATE ON drip_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.9 drip_templates — message variants with A/B metadata
CREATE TABLE drip_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  campaign_id    UUID NOT NULL REFERENCES drip_campaigns(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  channel        TEXT NOT NULL
                   CHECK (channel IN ('sms', 'email')),
  subject        TEXT,  -- email only
  body_template  TEXT NOT NULL,
  delay_hours    INTEGER NOT NULL DEFAULT 0,
  display_order  INTEGER NOT NULL DEFAULT 0,
  variant_label  TEXT,  -- A/B testing label
  active         BOOLEAN NOT NULL DEFAULT true,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER drip_templates_updated_at
  BEFORE UPDATE ON drip_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1.10 scheduled_actions — concrete scheduled sends, cancelable on reply
CREATE TABLE scheduled_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  campaign_id      UUID REFERENCES drip_campaigns(id) ON DELETE SET NULL,
  template_id      UUID REFERENCES drip_templates(id) ON DELETE SET NULL,
  matter_id        UUID REFERENCES matters(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  scheduled_for    TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  cancelled_reason TEXT,
  message_id       UUID REFERENCES messages(id) ON DELETE SET NULL,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER scheduled_actions_updated_at
  BEFORE UPDATE ON scheduled_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. Indexes
-- =============================================================================

-- Standard firm_id indexes
CREATE INDEX idx_approval_queue_firm_id ON approval_queue(firm_id);
CREATE INDEX idx_approvals_firm_id ON approvals(firm_id);
CREATE INDEX idx_jurisdictions_firm_id ON jurisdictions(firm_id);
CREATE INDEX idx_fee_quotes_firm_id ON fee_quotes(firm_id);
CREATE INDEX idx_engagement_letters_firm_id ON engagement_letters(firm_id);
CREATE INDEX idx_invoices_firm_id ON invoices(firm_id);
CREATE INDEX idx_integration_sync_state_firm_id ON integration_sync_state(firm_id);
CREATE INDEX idx_drip_campaigns_firm_id ON drip_campaigns(firm_id);
CREATE INDEX idx_drip_templates_firm_id ON drip_templates(firm_id);
CREATE INDEX idx_scheduled_actions_firm_id ON scheduled_actions(firm_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_approval_queue_firm_status ON approval_queue(firm_id, status);
CREATE INDEX idx_approval_queue_pending ON approval_queue(firm_id, priority DESC, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_fee_quotes_firm_status ON fee_quotes(firm_id, status);
CREATE INDEX idx_fee_quotes_matter ON fee_quotes(matter_id);
CREATE INDEX idx_engagement_letters_firm_status ON engagement_letters(firm_id, status);
CREATE INDEX idx_engagement_letters_matter ON engagement_letters(matter_id);
CREATE INDEX idx_invoices_firm_status ON invoices(firm_id, status);
CREATE INDEX idx_invoices_matter ON invoices(matter_id);
CREATE INDEX idx_scheduled_actions_pending ON scheduled_actions(scheduled_for)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_actions_matter ON scheduled_actions(matter_id);
CREATE INDEX idx_drip_templates_campaign ON drip_templates(campaign_id);

-- =============================================================================
-- 3. Row Level Security
-- =============================================================================

-- --- approval_queue ---
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm approval queue"
  ON approval_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = approval_queue.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm approval queue"
  ON approval_queue FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = approval_queue.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = approval_queue.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- approvals ---
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm approvals"
  ON approvals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = approvals.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE — immutable, service_role only

-- --- jurisdictions ---
ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm jurisdictions"
  ON jurisdictions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = jurisdictions.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated. Service_role only.

-- --- fee_quotes ---
ALTER TABLE fee_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm fee quotes"
  ON fee_quotes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = fee_quotes.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm fee quotes"
  ON fee_quotes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = fee_quotes.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = fee_quotes.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- engagement_letters ---
ALTER TABLE engagement_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm engagement letters"
  ON engagement_letters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = engagement_letters.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm engagement letters"
  ON engagement_letters FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = engagement_letters.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = engagement_letters.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- invoices ---
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm invoices"
  ON invoices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = invoices.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm invoices"
  ON invoices FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = invoices.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = invoices.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- integration_sync_state ---
ALTER TABLE integration_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm sync state"
  ON integration_sync_state FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = integration_sync_state.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated. Service_role only.

-- --- drip_campaigns ---
ALTER TABLE drip_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm drip campaigns"
  ON drip_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = drip_campaigns.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated. Service_role only.

-- --- drip_templates ---
ALTER TABLE drip_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm drip templates"
  ON drip_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = drip_templates.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated. Service_role only.

-- --- scheduled_actions ---
ALTER TABLE scheduled_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm scheduled actions"
  ON scheduled_actions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = scheduled_actions.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm scheduled actions"
  ON scheduled_actions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = scheduled_actions.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = scheduled_actions.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );
