-- 00002_leads_and_intake.sql
-- Lead ingestion, classification, conversations, pipeline, integrations
-- 11 tables, 2 enums, RLS policies, immutability triggers

-- =============================================================================
-- 1. Enums
-- =============================================================================

-- Only truly fixed sets get enums; everything else uses TEXT + CHECK
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE sender_type AS ENUM ('contact', 'ai', 'attorney', 'system');

-- =============================================================================
-- 2. Reusable Immutability Trigger
-- =============================================================================

-- Generic version of prevent_audit_log_mutation() — uses TG_TABLE_NAME dynamically
CREATE OR REPLACE FUNCTION prevent_row_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % operations are forbidden', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. Tables (ordered by FK dependencies)
-- =============================================================================

-- 3.1 pipeline_stages — per-firm stage definitions
CREATE TABLE pipeline_stages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  description         TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  sla_hours           INTEGER,
  allowed_transitions UUID[],
  is_terminal         BOOLEAN NOT NULL DEFAULT false,
  stage_type          TEXT NOT NULL
                        CHECK (stage_type IN (
                          'intake', 'qualification', 'negotiation',
                          'closing', 'post_close', 'terminal'
                        )),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, slug)
);

CREATE TRIGGER pipeline_stages_updated_at
  BEFORE UPDATE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.2 ai_jobs — every AI call logged (immutable, no updated_at)
CREATE TABLE ai_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  model              TEXT NOT NULL,
  purpose            TEXT NOT NULL
                       CHECK (purpose IN ('classify', 'converse', 'draft', 'judgment')),
  entity_type        TEXT,
  entity_id          UUID,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cost_cents         NUMERIC(10, 4),
  latency_ms         INTEGER,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error              TEXT,
  request_metadata   JSONB,
  response_metadata  JSONB,
  privileged         BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER no_ai_jobs_update
  BEFORE UPDATE ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_ai_jobs_delete
  BEFORE DELETE ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- 3.3 contacts — normalized people
CREATE TABLE contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email               TEXT,
  phone               TEXT,
  full_name           TEXT NOT NULL,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  country             TEXT DEFAULT 'US',
  preferred_language  TEXT DEFAULT 'en',
  timezone            TEXT DEFAULT 'America/Chicago',
  source_lead_id      UUID,  -- deferred FK, set after leads table exists
  dnc                 BOOLEAN NOT NULL DEFAULT false,
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.4 leads — raw inbound
CREATE TABLE leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  source        TEXT NOT NULL
                  CHECK (source IN (
                    'legalmatch', 'nonstop', 'dialpad',
                    'manual', 'website', 'referral'
                  )),
  status        TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN (
                    'new', 'contacted', 'qualified', 'unqualified',
                    'converted', 'dead', 'dnc'
                  )),
  channel       TEXT,
  full_name     TEXT,
  email         TEXT,
  phone         TEXT,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  payload       JSONB,
  priority      INTEGER DEFAULT 0,
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Now add the deferred FK from contacts.source_lead_id → leads.id
ALTER TABLE contacts
  ADD CONSTRAINT fk_contacts_source_lead
  FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- 3.5 classifications — AI classification results (immutable)
CREATE TABLE classifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  matter_type TEXT NOT NULL,
  confidence  NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  signals     JSONB,
  model       TEXT NOT NULL,
  ai_job_id   UUID REFERENCES ai_jobs(id) ON DELETE SET NULL,
  is_current  BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER no_classifications_update
  BEFORE UPDATE ON classifications
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_classifications_delete
  BEFORE DELETE ON classifications
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- 3.6 matters — legal matter, primary workflow unit
CREATE TABLE matters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  matter_type   TEXT,
  stage_id      UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN (
                    'active', 'on_hold', 'closed_won', 'closed_lost', 'dead'
                  )),
  jurisdiction  TEXT,
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  summary       TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER matters_updated_at
  BEFORE UPDATE ON matters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.7 matter_stage_history — every pipeline transition (immutable)
CREATE TABLE matter_stage_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id     UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  to_stage_id   UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER no_matter_stage_history_update
  BEFORE UPDATE ON matter_stage_history
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_matter_stage_history_delete
  BEFORE DELETE ON matter_stage_history
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- 3.8 conversations — one per lead
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'closed', 'escalated')),
  phase           TEXT NOT NULL DEFAULT 'initial_contact'
                    CHECK (phase IN (
                      'initial_contact', 'qualification', 'scheduling',
                      'follow_up', 'negotiation', 'closing'
                    )),
  context         JSONB,
  channel         TEXT,
  last_message_at TIMESTAMPTZ,
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.9 messages — inbound/outbound
CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction        message_direction NOT NULL,
  channel          TEXT,
  content          TEXT,
  sender_type      sender_type NOT NULL,
  sender_id        UUID,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN (
                       'draft', 'pending_approval', 'approved',
                       'sent', 'delivered', 'failed', 'rejected'
                     )),
  ai_generated     BOOLEAN NOT NULL DEFAULT false,
  approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  external_id      TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.10 integration_accounts — per-firm credentials
CREATE TABLE integration_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL
                  CHECK (provider IN (
                    'dialpad', 'gmail', 'confido',
                    'dropbox_sign', 'postmark'
                  )),
  credentials   JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'error')),
  last_sync_at  TIMESTAMPTZ,
  config        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, provider)
);

CREATE TRIGGER integration_accounts_updated_at
  BEFORE UPDATE ON integration_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.11 webhook_events — raw inbound payloads (firm_id NULLABLE)
CREATE TABLE webhook_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          UUID REFERENCES firms(id) ON DELETE SET NULL,
  provider         TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  processed_at     TIMESTAMPTZ,
  error            TEXT,
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 4. Indexes
-- =============================================================================

-- Standard firm_id indexes
CREATE INDEX idx_pipeline_stages_firm_id ON pipeline_stages(firm_id);
CREATE INDEX idx_ai_jobs_firm_id ON ai_jobs(firm_id);
CREATE INDEX idx_contacts_firm_id ON contacts(firm_id);
CREATE INDEX idx_leads_firm_id ON leads(firm_id);
CREATE INDEX idx_classifications_firm_id ON classifications(firm_id);
CREATE INDEX idx_matters_firm_id ON matters(firm_id);
CREATE INDEX idx_matter_stage_history_firm_id ON matter_stage_history(firm_id);
CREATE INDEX idx_conversations_firm_id ON conversations(firm_id);
CREATE INDEX idx_messages_firm_id ON messages(firm_id);
CREATE INDEX idx_integration_accounts_firm_id ON integration_accounts(firm_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_leads_firm_status ON leads(firm_id, status);
CREATE INDEX idx_leads_firm_created ON leads(firm_id, created_at DESC);
CREATE INDEX idx_matters_firm_status ON matters(firm_id, status);
CREATE INDEX idx_conversations_firm_status ON conversations(firm_id, status);
CREATE INDEX idx_messages_firm_status ON messages(firm_id, status);
CREATE INDEX idx_ai_jobs_firm_created ON ai_jobs(firm_id, created_at DESC);

-- Partial indexes for hot paths
CREATE INDEX idx_classifications_current
  ON classifications(lead_id, is_current)
  WHERE is_current = true;

CREATE INDEX idx_messages_external_id
  ON messages(external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_webhook_events_firm_id
  ON webhook_events(firm_id)
  WHERE firm_id IS NOT NULL;

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================

-- Inline EXISTS pattern (same as foundation migration):
-- EXISTS (SELECT 1 FROM firm_users WHERE firm_users.firm_id = X.firm_id AND firm_users.user_id = auth.uid())

-- --- pipeline_stages ---
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm pipeline stages"
  ON pipeline_stages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = pipeline_stages.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- --- ai_jobs ---
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm AI jobs"
  ON ai_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = ai_jobs.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- --- contacts ---
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm contacts"
  ON contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = contacts.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- --- leads ---
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm leads"
  ON leads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = leads.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm leads"
  ON leads FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = leads.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney', 'paralegal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = leads.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney', 'paralegal')
    )
  );

-- --- classifications ---
ALTER TABLE classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm classifications"
  ON classifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = classifications.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- --- matters ---
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm matters"
  ON matters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = matters.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm matters"
  ON matters FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = matters.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = matters.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- matter_stage_history ---
ALTER TABLE matter_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm stage history"
  ON matter_stage_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = matter_stage_history.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- --- conversations ---
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = conversations.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = conversations.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = conversations.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- messages ---
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = messages.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Authorized users can update own firm messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = messages.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = messages.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role IN ('owner', 'attorney')
    )
  );

-- --- integration_accounts ---
ALTER TABLE integration_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm integration accounts"
  ON integration_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = integration_accounts.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- --- webhook_events ---
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Only visible when firm_id is resolved AND user belongs to that firm
CREATE POLICY "Users can view own firm webhook events"
  ON webhook_events FOR SELECT
  USING (
    firm_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = webhook_events.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );
