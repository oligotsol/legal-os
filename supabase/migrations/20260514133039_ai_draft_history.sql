-- 20260514133039_ai_draft_history.sql
-- Captures the complete lifecycle of an AI-drafted message: original draft,
-- each redraft + the instructions Garrison gave, and the final human edit.
-- The goal is to mine this later to improve the underlying prompts and to
-- fine-tune / few-shot the conversation model. Without this, redraft
-- mutations on messages.content destroy the "what did the AI say first?"
-- signal we need for training.
--
-- One row per draft revision. Append-only.

CREATE TABLE ai_draft_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,

  -- What this draft is attached to (denormalized for query convenience)
  message_id         UUID REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id    UUID REFERENCES conversations(id) ON DELETE SET NULL,
  lead_id            UUID REFERENCES leads(id) ON DELETE SET NULL,
  approval_queue_id  UUID REFERENCES approval_queue(id) ON DELETE SET NULL,
  ai_job_id          UUID REFERENCES ai_jobs(id) ON DELETE SET NULL,

  -- The content at this revision
  content            TEXT NOT NULL,

  -- What produced this revision
  source             TEXT NOT NULL CHECK (source IN (
    'ai_initial',     -- first AI draft (e.g. response to inbound)
    'ai_redraft',     -- AI re-drafted in response to human instructions
    'human_edit',     -- human edited the AI draft directly (typed in)
    'human_send'      -- final content actually sent (snapshot at dispatch)
  )),

  -- If source = 'ai_redraft', the instructions the human gave
  redraft_instructions TEXT,

  -- AI metadata (null when source = 'human_edit' / 'human_send')
  ai_model           TEXT,

  -- Human actor (null when source = 'ai_initial' / 'ai_redraft')
  actor_id           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Revision number within the message lifecycle (1, 2, 3...)
  revision_number    INT NOT NULL,

  -- Snapshot of context at draft time — what the AI was given when it
  -- drafted, OR what the human was looking at when they edited. The shape
  -- is intentionally flexible:
  --   { matter_type, client_description, recent_messages: [...], channel,
  --     conversation_phase, ... }
  -- This is the training-data payload.
  context_snapshot   JSONB,

  -- Channel of the message being drafted (sms / email)
  channel            TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_draft_history_message     ON ai_draft_history(message_id);
CREATE INDEX idx_ai_draft_history_firm        ON ai_draft_history(firm_id, created_at DESC);
CREATE INDEX idx_ai_draft_history_lead        ON ai_draft_history(lead_id);
CREATE INDEX idx_ai_draft_history_source      ON ai_draft_history(firm_id, source, created_at DESC);
CREATE INDEX idx_ai_draft_history_ai_job      ON ai_draft_history(ai_job_id);

-- Append-only: prevent UPDATE and DELETE
CREATE TRIGGER no_ai_draft_history_update
  BEFORE UPDATE ON ai_draft_history
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER no_ai_draft_history_delete
  BEFORE DELETE ON ai_draft_history
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- RLS — same pattern as lead_stage_history. Service role bypasses RLS so
-- the server-action inserts go through; authenticated users in the firm
-- can view (for future debug UI).
ALTER TABLE ai_draft_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own firm draft history"
  ON ai_draft_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = ai_draft_history.firm_id
      AND firm_users.user_id = auth.uid()
    )
  );
