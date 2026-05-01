import { describe, it, expect } from "vitest";
import { calculateQuote } from "@/lib/pricing/quote-calculator";
import type { Service, ServiceBundle, DiscountTier } from "@/types/database";

// --- Test fixtures ---

const makeService = (
  overrides: Partial<Service> & Pick<Service, "id" | "name" | "standard_price" | "floor_price">
): Service => ({
  firm_id: "firm-1",
  slug: overrides.name.toLowerCase().replace(/\s/g, "_"),
  category: "estate_planning",
  description: null,
  filing_fee: null,
  status: "active",
  created_at: "",
  updated_at: "",
  ...overrides,
});

const services: Service[] = [
  makeService({
    id: "svc-will",
    name: "Simple Will",
    standard_price: 500,
    floor_price: 500,
  }),
  makeService({
    id: "svc-poa",
    name: "Financial POA",
    standard_price: 250,
    floor_price: 250,
  }),
  makeService({
    id: "svc-trust",
    name: "Revocable Living Trust",
    standard_price: 2000,
    floor_price: 1500,
  }),
  makeService({
    id: "svc-llc",
    name: "LLC Formation",
    standard_price: 1500,
    floor_price: 1000,
  }),
  makeService({
    id: "svc-oa",
    name: "Operating Agreement",
    standard_price: 2000,
    floor_price: 1000,
  }),
];

const bundles: ServiceBundle[] = [
  {
    id: "bundle-bare",
    firm_id: "firm-1",
    name: "Bare Bones",
    slug: "bare_bones",
    description: null,
    bundle_price: 650,
    floor_price: 500,
    service_ids: ["svc-will", "svc-poa"],
    active: true,
    created_at: "",
    updated_at: "",
  },
  {
    id: "bundle-biz",
    firm_id: "firm-1",
    name: "Small Business Owner",
    slug: "small_business_owner",
    description: null,
    bundle_price: 4500,
    floor_price: 3375,
    service_ids: ["svc-llc", "svc-oa", "svc-trust"],
    active: true,
    created_at: "",
    updated_at: "",
  },
];

const tiers: DiscountTier[] = [
  {
    id: "tier-3k",
    firm_id: "firm-1",
    engagement_threshold: 3000,
    discount_amount: 500,
    active: true,
    created_at: "",
    updated_at: "",
  },
  {
    id: "tier-5k",
    firm_id: "firm-1",
    engagement_threshold: 5000,
    discount_amount: 1000,
    active: true,
    created_at: "",
    updated_at: "",
  },
  {
    id: "tier-10k",
    firm_id: "firm-1",
    engagement_threshold: 10000,
    discount_amount: 2500,
    active: true,
    created_at: "",
    updated_at: "",
  },
];

// --- Tests ---

describe("calculateQuote", () => {
  // ---- Single service ----

  it("calculates a single service at standard price", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-will"] },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(500);
    expect(result.total_quoted_fee).toBe(500);
    expect(result.engagement_tier_discount).toBe(0);
    expect(result.line_items).toHaveLength(1);
  });

  // ---- Multiple services ----

  it("sums multiple services correctly", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-will", "svc-poa"] },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(750);
    expect(result.total_quoted_fee).toBe(750);
    expect(result.line_items).toHaveLength(2);
  });

  // ---- Tier discount ----

  it("applies $500 tier discount when subtotal >= $3,000", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-trust", "svc-llc"] },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(3500);
    expect(result.engagement_tier_discount).toBe(500);
    expect(result.total_quoted_fee).toBe(3000);
  });

  it("applies highest qualifying tier only", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-trust", "svc-llc", "svc-oa"] },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(5500);
    expect(result.engagement_tier_discount).toBe(1000); // $5k tier, not $3k
    expect(result.total_quoted_fee).toBe(4500);
  });

  // ---- Floor pricing ----

  it("uses floor pricing when apply_floor_pricing is true", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-trust"], apply_floor_pricing: true },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(1500); // floor
    expect(result.total_quoted_fee).toBe(1500);
  });

  it("never goes below floor total even with tier discount", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-trust", "svc-llc"], apply_floor_pricing: true },
      services,
      bundles,
      tiers
    );

    // Floor: 1500 + 1000 = 2500, no tier discount applies (2500 < 3000)
    expect(result.subtotal).toBe(2500);
    expect(result.floor_total).toBe(2500);
    expect(result.total_quoted_fee).toBe(2500);
  });

  // ---- Headroom ----

  it("calculates negotiation headroom correctly", () => {
    const result = calculateQuote(
      { selected_service_ids: ["svc-trust"] },
      services,
      bundles,
      tiers
    );

    // standard 2000 - floor 1500 = 500
    expect(result.negotiation_headroom).toBe(500);
  });

  // ---- Bundles ----

  it("uses bundle pricing when use_bundle_id is specified", () => {
    const result = calculateQuote(
      { selected_service_ids: [], use_bundle_id: "bundle-bare" },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(650); // bundle price
    expect(result.bundle_discount).toBe(100); // standalone 750 - bundle 650
    expect(result.total_quoted_fee).toBe(650);
  });

  it("applies tier discount on bundle price", () => {
    const result = calculateQuote(
      { selected_service_ids: [], use_bundle_id: "bundle-biz" },
      services,
      bundles,
      tiers
    );

    expect(result.subtotal).toBe(4500);
    expect(result.engagement_tier_discount).toBe(500); // $3k tier
    expect(result.total_quoted_fee).toBe(4000);
  });

  it("bundle floor prevents over-discounting", () => {
    const result = calculateQuote(
      { selected_service_ids: [], use_bundle_id: "bundle-biz", apply_floor_pricing: true },
      services,
      bundles,
      tiers
    );

    // Floor pricing: 3375, $3k tier discount would give 2875, but floor is 3375
    expect(result.subtotal).toBe(3375);
    expect(result.total_quoted_fee).toBe(3375);
  });

  // ---- Error cases ----

  it("throws on unknown service ID", () => {
    expect(() =>
      calculateQuote(
        { selected_service_ids: ["nonexistent"] },
        services,
        bundles,
        tiers
      )
    ).toThrow("Service nonexistent not found");
  });

  it("throws on unknown bundle ID", () => {
    expect(() =>
      calculateQuote(
        { selected_service_ids: [], use_bundle_id: "nonexistent" },
        services,
        bundles,
        tiers
      )
    ).toThrow("Bundle nonexistent not found");
  });

  // ---- Inactive tiers ----

  it("ignores inactive discount tiers", () => {
    const inactiveTiers: DiscountTier[] = tiers.map((t) => ({
      ...t,
      active: false,
    }));

    const result = calculateQuote(
      { selected_service_ids: ["svc-trust", "svc-llc"] },
      services,
      bundles,
      inactiveTiers
    );

    expect(result.subtotal).toBe(3500);
    expect(result.engagement_tier_discount).toBe(0);
    expect(result.total_quoted_fee).toBe(3500);
  });
});
