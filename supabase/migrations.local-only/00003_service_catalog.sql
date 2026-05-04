-- 00003_service_catalog.sql
-- Service catalog, bundles, and discount tiers for fee quoting
-- Per-firm pricing configuration — no vertical-specific strings

-- =============================================================================
-- 1. Tables
-- =============================================================================

-- services — individual billable services per firm
CREATE TABLE services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  category        TEXT NOT NULL
                    CHECK (category IN (
                      'estate_planning', 'business_transactional', 'trademark'
                    )),
  description     TEXT,
  standard_price  NUMERIC(10, 2) NOT NULL CHECK (standard_price > 0),
  floor_price     NUMERIC(10, 2) NOT NULL CHECK (floor_price > 0),
  filing_fee      NUMERIC(10, 2),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'consultation_required')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, slug),
  CHECK (floor_price <= standard_price)
);

CREATE TRIGGER services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- service_bundles — grouped services at a discount
CREATE TABLE service_bundles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  bundle_price    NUMERIC(10, 2) NOT NULL CHECK (bundle_price > 0),
  floor_price     NUMERIC(10, 2) NOT NULL CHECK (floor_price > 0),
  service_ids     UUID[] NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, slug),
  CHECK (floor_price <= bundle_price)
);

CREATE TRIGGER service_bundles_updated_at
  BEFORE UPDATE ON service_bundles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- discount_tiers — engagement-total-based discounts
CREATE TABLE discount_tiers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                 UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  engagement_threshold    NUMERIC(10, 2) NOT NULL CHECK (engagement_threshold > 0),
  discount_amount         NUMERIC(10, 2) NOT NULL CHECK (discount_amount > 0),
  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(firm_id, engagement_threshold)
);

CREATE TRIGGER discount_tiers_updated_at
  BEFORE UPDATE ON discount_tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. Indexes
-- =============================================================================

CREATE INDEX idx_services_firm_id ON services(firm_id);
CREATE INDEX idx_services_firm_category ON services(firm_id, category);
CREATE INDEX idx_services_firm_status ON services(firm_id, status);
CREATE INDEX idx_service_bundles_firm_id ON service_bundles(firm_id);
CREATE INDEX idx_service_bundles_firm_active ON service_bundles(firm_id, active);
CREATE INDEX idx_discount_tiers_firm_id ON discount_tiers(firm_id);
CREATE INDEX idx_discount_tiers_firm_threshold ON discount_tiers(firm_id, engagement_threshold DESC);

-- =============================================================================
-- 3. Row Level Security
-- =============================================================================

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_tiers ENABLE ROW LEVEL SECURITY;

-- SELECT for all firm members (inline EXISTS pattern)
CREATE POLICY "Users can view own firm services"
  ON services FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = services.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own firm bundles"
  ON service_bundles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = service_bundles.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own firm discount tiers"
  ON discount_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_users
      WHERE firm_users.firm_id = discount_tiers.firm_id
        AND firm_users.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated users.
-- Pricing management is service_role only.
