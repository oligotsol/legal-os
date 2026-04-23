-- 00001_foundation.sql
-- Foundation schema: firms, users, firm_users, firm_config, audit_log
-- Multi-tenant core with RLS and hash-chained audit log

-- =============================================================================
-- 1. Extensions & Helpers
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Role enum for firm membership
CREATE TYPE user_role AS ENUM ('owner', 'attorney', 'paralegal', 'assistant', 'viewer');

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: returns firm_ids for the current authenticated user.
-- SECURITY DEFINER bypasses RLS so the firm_users SELECT policy can check
-- membership without infinite recursion (firm_users referencing itself).
-- Other tables use inline EXISTS subqueries for better query optimization.
CREATE OR REPLACE FUNCTION get_my_firm_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT firm_id FROM firm_users WHERE user_id = auth.uid();
$$;

-- =============================================================================
-- 2. Tables
-- =============================================================================

-- firms: tenant table (no firm_id — this IS the tenant)
CREATE TABLE firms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'churned')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER firms_updated_at
  BEFORE UPDATE ON firms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- users: global identity (no firm_id — membership via firm_users)
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  phone       TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- firm_users: firm membership junction
CREATE TABLE firm_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, user_id)
);

CREATE INDEX idx_firm_users_firm_id ON firm_users(firm_id);
CREATE INDEX idx_firm_users_user_id ON firm_users(user_id);

CREATE TRIGGER firm_users_updated_at
  BEFORE UPDATE ON firm_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- firm_config: per-firm key/value config
CREATE TABLE firm_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, key)
);

CREATE INDEX idx_firm_config_firm_id ON firm_config(firm_id);

CREATE TRIGGER firm_config_updated_at
  BEFORE UPDATE ON firm_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- audit_log: append-only, hash-chained (no updated_at — immutable)
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE RESTRICT,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  before      JSONB,
  after       JSONB,
  metadata    JSONB,
  hash        TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_firm_id ON audit_log(firm_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(firm_id, created_at DESC);

-- =============================================================================
-- 3. Audit Log Immutability
-- =============================================================================

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % operations are forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_audit_log_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER no_audit_log_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- =============================================================================
-- 4. Auth Trigger (auto-create user profile on signup)
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- 5. Audit Log Hash-Chain Insert Function
-- =============================================================================

CREATE OR REPLACE FUNCTION insert_audit_log(
  p_firm_id     UUID,
  p_actor_id    UUID,
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID DEFAULT NULL,
  p_before      JSONB DEFAULT NULL,
  p_after       JSONB DEFAULT NULL,
  p_metadata    JSONB DEFAULT NULL
)
RETURNS audit_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_prev_hash  TEXT;
  v_created_at TIMESTAMPTZ;
  v_hash       TEXT;
  v_result     audit_log;
BEGIN
  -- Server controls the timestamp — not the caller
  v_created_at := now();

  -- Fetch the most recent hash for this firm's chain
  SELECT hash INTO v_prev_hash
  FROM audit_log
  WHERE firm_id = p_firm_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;  -- lock to prevent concurrent chain breaks

  -- Genesis: first entry in a firm's chain
  IF v_prev_hash IS NULL THEN
    v_prev_hash := 'GENESIS';
  END IF;

  -- hash = sha256(prev_hash || action || entity_type || entity_id || before || after || created_at)
  v_hash := encode(
    digest(
      v_prev_hash
        || p_action
        || p_entity_type
        || COALESCE(p_entity_id::text, '')
        || COALESCE(p_before::text, '')
        || COALESCE(p_after::text, '')
        || v_created_at::text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO audit_log (
    firm_id, actor_id, action, entity_type, entity_id,
    before, after, metadata, hash, prev_hash, created_at
  )
  VALUES (
    p_firm_id, p_actor_id, p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_metadata, v_hash, v_prev_hash, v_created_at
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Only service_role and postgres can call this function.
-- Authenticated users trigger audit entries via server actions, never directly.
REVOKE EXECUTE ON FUNCTION insert_audit_log FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION insert_audit_log FROM authenticated;
REVOKE EXECUTE ON FUNCTION insert_audit_log FROM anon;

-- =============================================================================
-- 6. Row Level Security Policies
-- =============================================================================

-- RLS strategy:
-- - firm_users uses get_my_firm_ids() (SECURITY DEFINER) to avoid infinite
--   recursion from self-referencing its own RLS policy.
-- - All other tables use inline EXISTS subqueries against firm_users, which
--   Postgres can optimize as joins. These don't recurse because firm_users'
--   own policy is resolved via get_my_firm_ids().

-- firms ---
ALTER TABLE firms ENABLE ROW LEVEL SECURITY;

-- Users can see firms they belong to
CREATE POLICY "Users can view own firms"
  ON firms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = firms.id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for authenticated.
-- Firm creation/management is service_role only.

-- users ---
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can see themselves and colleagues in the same firm
CREATE POLICY "Users can view own profile and firm colleagues"
  ON users FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM firm_users fu1
      INNER JOIN firm_users fu2 ON fu1.firm_id = fu2.firm_id
      WHERE fu1.user_id = auth.uid()
        AND fu2.user_id = users.id
    )
  );

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No INSERT policy — rows created by auth trigger (SECURITY DEFINER).
-- No DELETE policy — account deletion is service_role only.

-- firm_users ---
ALTER TABLE firm_users ENABLE ROW LEVEL SECURITY;

-- Uses get_my_firm_ids() (SECURITY DEFINER) to break self-referencing recursion.
-- An inline EXISTS on firm_users from firm_users' own policy would cause
-- infinite recursion because the inner query triggers the same policy.
CREATE POLICY "Users can view firm memberships"
  ON firm_users FOR SELECT
  USING (firm_id IN (SELECT get_my_firm_ids()));

-- No INSERT/UPDATE/DELETE for authenticated.
-- Membership management is service_role only.

-- firm_config ---
ALTER TABLE firm_config ENABLE ROW LEVEL SECURITY;

-- Users can see config for their firm(s)
CREATE POLICY "Users can view own firm config"
  ON firm_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = firm_config.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- Owners can update their firm's config
CREATE POLICY "Owners can update firm config"
  ON firm_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = firm_config.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = firm_config.firm_id
        AND firm_users.user_id = auth.uid()
        AND firm_users.role = 'owner'
    )
  );

-- No INSERT/DELETE for authenticated. Service_role only.

-- audit_log ---
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Users can read audit logs for their firm(s)
CREATE POLICY "Users can view own firm audit log"
  ON audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = audit_log.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT policy — inserts go through insert_audit_log() which is SECURITY DEFINER.
-- No UPDATE/DELETE policies — triggers prevent these operations for ALL roles.
