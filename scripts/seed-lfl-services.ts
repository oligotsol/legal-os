/**
 * seed-lfl-services.ts — Seed LFL service catalog
 *
 * Seeds 36 services, 10 bundles, 4 discount tiers, and the
 * negotiation config (firm_config) for Legacy First Law.
 *
 * Usage:
 *   npx tsx scripts/seed-lfl-services.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent — uses upsert on unique constraints.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

// =============================================================================
// Service definitions (slug is the stable key for upsert)
// =============================================================================

interface ServiceDef {
  name: string;
  slug: string;
  category: "estate_planning" | "business_transactional" | "trademark";
  standard_price: number;
  floor_price: number;
  filing_fee?: number;
}

const SERVICES: ServiceDef[] = [
  // --- Estate Planning (12) ---
  { name: "Simple Will (Individual)", slug: "simple_will", category: "estate_planning", standard_price: 500, floor_price: 500 },
  { name: "Joint Wills (Married Couple)", slug: "joint_wills", category: "estate_planning", standard_price: 1000, floor_price: 750 },
  { name: "Revocable Living Trust (Individual)", slug: "revocable_living_trust_individual", category: "estate_planning", standard_price: 2000, floor_price: 1500 },
  { name: "Revocable Living Trust (Joint/Married)", slug: "revocable_living_trust_joint", category: "estate_planning", standard_price: 2000, floor_price: 1500 },
  { name: "Irrevocable Trust", slug: "irrevocable_trust", category: "estate_planning", standard_price: 3500, floor_price: 2000 },
  { name: "Financial Power of Attorney", slug: "financial_poa", category: "estate_planning", standard_price: 250, floor_price: 250 },
  { name: "Healthcare Directive / Advance Directive", slug: "healthcare_directive", category: "estate_planning", standard_price: 250, floor_price: 250 },
  { name: "HIPAA Authorization", slug: "hipaa_authorization", category: "estate_planning", standard_price: 250, floor_price: 250 },
  { name: "Deed (Warranty / Quitclaim / Lady Bird / TOD)", slug: "deed_any", category: "estate_planning", standard_price: 500, floor_price: 350 },
  { name: "Special Needs Trust", slug: "special_needs_trust", category: "estate_planning", standard_price: 3500, floor_price: 2000 },
  { name: "Comprehensive EP Package (Individual)", slug: "comprehensive_ep_individual", category: "estate_planning", standard_price: 3000, floor_price: 2000 },
  { name: "Comprehensive EP Package (Married Couple)", slug: "comprehensive_ep_married", category: "estate_planning", standard_price: 3500, floor_price: 2500 },

  // --- Business Transactional (9) ---
  { name: "LLC Formation (Single-Member)", slug: "llc_formation_single", category: "business_transactional", standard_price: 1500, floor_price: 1000 },
  { name: "LLC Formation (Multi-Member)", slug: "llc_formation_multi", category: "business_transactional", standard_price: 1500, floor_price: 1000 },
  { name: "Operating Agreement", slug: "operating_agreement", category: "business_transactional", standard_price: 2000, floor_price: 1000 },
  { name: "Corporate Bylaws", slug: "corporate_bylaws", category: "business_transactional", standard_price: 1500, floor_price: 1000 },
  { name: "NDA / Confidentiality Agreement", slug: "nda", category: "business_transactional", standard_price: 1500, floor_price: 750 },
  { name: "Employment Agreement", slug: "employment_agreement", category: "business_transactional", standard_price: 1500, floor_price: 1000 },
  { name: "Partnership Agreement", slug: "partnership_agreement", category: "business_transactional", standard_price: 2000, floor_price: 1000 },
  { name: "Commercial Lease Review", slug: "commercial_lease_review", category: "business_transactional", standard_price: 1500, floor_price: 500 },
  { name: "Annual Compliance / Governance", slug: "annual_compliance", category: "business_transactional", standard_price: 1500, floor_price: 1000 },

  // --- Trademarks (15) ---
  { name: "Trademark Clearance Search", slug: "tm_clearance_search", category: "trademark", standard_price: 800, floor_price: 600 },
  { name: "TEAS Plus Application (single class)", slug: "tm_teas_plus", category: "trademark", standard_price: 1800, floor_price: 1350, filing_fee: 250 },
  { name: "TEAS Standard Application (single class)", slug: "tm_teas_standard", category: "trademark", standard_price: 2400, floor_price: 1800, filing_fee: 350 },
  { name: "Statement of Use (after NOA)", slug: "tm_statement_of_use", category: "trademark", standard_price: 800, floor_price: 600, filing_fee: 150 },
  { name: "Intent-to-Use Extension (6-month)", slug: "tm_itu_extension", category: "trademark", standard_price: 600, floor_price: 450, filing_fee: 125 },
  { name: "Office Action Response (non-substantive)", slug: "tm_oar_non_substantive", category: "trademark", standard_price: 1500, floor_price: 1125 },
  { name: "Office Action Response (substantive)", slug: "tm_oar_substantive", category: "trademark", standard_price: 3000, floor_price: 2250 },
  { name: "Section 8 Declaration (5-6 year window)", slug: "tm_section_8", category: "trademark", standard_price: 600, floor_price: 450, filing_fee: 225 },
  { name: "Section 9 Renewal (10-year)", slug: "tm_section_9", category: "trademark", standard_price: 800, floor_price: 600, filing_fee: 525 },
  { name: "Trademark Assignment Recordation with USPTO", slug: "tm_assignment", category: "trademark", standard_price: 500, floor_price: 375, filing_fee: 40 },
  { name: "Trademark Cease-and-Desist Letter", slug: "tm_cease_desist", category: "trademark", standard_price: 1000, floor_price: 750 },
  { name: "Trademark License Agreement", slug: "tm_license_agreement", category: "trademark", standard_price: 3000, floor_price: 2250 },
  { name: "Annual Trademark Docketing + Maintenance (per mark)", slug: "tm_annual_maintenance", category: "trademark", standard_price: 300, floor_price: 225 },
  { name: "Full TM Prosecution Bundle (TEAS Plus)", slug: "tm_full_prosecution_teas_plus", category: "trademark", standard_price: 2400, floor_price: 1500, filing_fee: 250 },
  { name: "Full TM Prosecution Bundle (TEAS Standard)", slug: "tm_full_prosecution_teas_standard", category: "trademark", standard_price: 3000, floor_price: 2000, filing_fee: 350 },
];

// =============================================================================
// Bundle definitions (reference services by slug)
// =============================================================================

interface BundleDef {
  name: string;
  slug: string;
  bundle_price: number;
  floor_price: number;
  service_slugs: string[];
}

const BUNDLES: BundleDef[] = [
  {
    name: "Bare Bones Bundle (Will + POA)",
    slug: "bare_bones",
    bundle_price: 650,
    floor_price: 500,
    service_slugs: ["simple_will", "financial_poa"],
  },
  {
    name: "Will + POA + Healthcare Directive Bundle",
    slug: "will_poa_healthcare",
    bundle_price: 1000,
    floor_price: 750,
    service_slugs: ["simple_will", "financial_poa", "healthcare_directive"],
  },
  {
    name: "Starter Parent Bundle (Individual)",
    slug: "starter_parent_individual",
    bundle_price: 850,
    floor_price: 650,
    service_slugs: ["simple_will", "healthcare_directive", "financial_poa"],
  },
  {
    name: "Starter Parent Bundle (Married)",
    slug: "starter_parent_married",
    bundle_price: 1500,
    floor_price: 1125,
    service_slugs: ["joint_wills", "healthcare_directive", "financial_poa"],
  },
  {
    name: "Real Estate Protection (Individual)",
    slug: "real_estate_individual",
    bundle_price: 2250,
    floor_price: 1700,
    service_slugs: ["revocable_living_trust_individual", "deed_any", "financial_poa"],
  },
  {
    name: "Real Estate Protection (Married)",
    slug: "real_estate_married",
    bundle_price: 2500,
    floor_price: 1875,
    service_slugs: ["revocable_living_trust_joint", "deed_any", "financial_poa"],
  },
  {
    name: "Trust + POA + Healthcare Bundle (Married)",
    slug: "trust_poa_healthcare_married",
    bundle_price: 2500,
    floor_price: 1500,
    service_slugs: ["revocable_living_trust_joint", "financial_poa", "healthcare_directive"],
  },
  {
    name: "Trust + LLC + POA + Healthcare Bundle (Married)",
    slug: "trust_llc_poa_healthcare_married",
    bundle_price: 3500,
    floor_price: 2000,
    service_slugs: [
      "revocable_living_trust_joint",
      "llc_formation_single",
      "operating_agreement",
      "financial_poa",
      "healthcare_directive",
    ],
  },
  {
    name: "Small Business Owner Bundle",
    slug: "small_business_owner",
    bundle_price: 4500,
    floor_price: 3375,
    service_slugs: ["llc_formation_single", "operating_agreement", "revocable_living_trust_individual"],
  },
  {
    name: "Founder Protection Pack",
    slug: "founder_protection",
    bundle_price: 6500,
    floor_price: 4900,
    service_slugs: [
      "llc_formation_single",
      "operating_agreement",
      "revocable_living_trust_individual",
      "tm_full_prosecution_teas_plus",
    ],
  },
];

// =============================================================================
// Discount tiers
// =============================================================================

const DISCOUNT_TIERS = [
  { engagement_threshold: 3000, discount_amount: 500 },
  { engagement_threshold: 5000, discount_amount: 1000 },
  { engagement_threshold: 10000, discount_amount: 2500 },
  { engagement_threshold: 20000, discount_amount: 5000 },
];

// =============================================================================
// Negotiation config (goes into firm_config)
// =============================================================================

const NEGOTIATION_CONFIG = {
  firm_name: "Legacy First Law PLLC",
  attorney_name: "Garrison",
  tone: "Warm, direct, Texas-friendly. Use contractions. Lead with empathy, follow with urgency. Never sycophantic. Never use banned phrases or close variants. Never use em dashes (—) or en dashes (–). Use periods, commas, or parentheses instead.",
  key_phrases: [
    "I get it — this stuff isn't fun, but it matters.",
    "Let me make this easy for you.",
    "Most folks put this off. Let's not be most folks.",
    "We keep it simple — flat fee, no surprises, done fast.",
    "The cost of NOT doing this is way higher.",
    "You're not just protecting yourself — you're protecting the people you love.",
    "I've seen what happens when there's no plan. It's ugly and expensive.",
    "We handle everything — you just show up and sign.",
    "Think of this as insurance that actually works.",
    "Probate costs 10x what planning does. Let's skip probate.",
  ],
  competitive_advantages: [
    "72-hour standard turnaround, rush (<48h) available for +$1,000",
    "Flat fees only — no hourly, no surprise invoices",
    "All digital, completely remote",
    "Work with you until it's perfect",
    "Beat solo and mid-size firms on pricing + speed",
  ],
  payment_options: [
    "100% upfront (preferred)",
    "50/50 split",
    "1/3 deposit, 1/3 month 1, 1/3 month 2 (all within 2 months)",
    "Payment plans available (requires attorney approval)",
  ],
  turnaround: "72 hours standard, rush <48h available for +$1,000",
  disqualify_rules: [
    "Unable to pay (offer pro bono referral only if attorney approves)",
    "Out of scope for firm's practice areas",
  ],
  referral_rules: [
    "Litigation, disputes, contested wills, lawsuits → refer to Amicus Lex",
    "Pre-litigation matters → refer to Amicus Lex immediately",
  ],
  qualifying_questions: [
    "Estate size / complexity?",
    "Married or single?",
    "Kids or dependents?",
    "Business interests?",
    "Any prior legal work?",
    "Timeline — how urgent?",
  ],
  objection_scripts: {
    "Client asks about cost": `1. Ask clarifying questions first (estate size, complexity, marital status)
2. Quote standard price
3. Say: "That's our standard flat fee — no hourly billing, no surprise invoices. All work done for that price."
4. If client hesitates: "I understand. What concerns you most — the investment or the timeline?"`,
    "Client mentions competitor pricing": `Say: "I hear that. Here's what matters: we deliver in 72 hours flat, all digital, and we work with you until it's perfect. Most competitors drag this out months. The real cost is your time and risk."

If they push harder on price:
"Let me see what I can do. [Quote floor price]. That's my absolute bottom — it's where we break even on the work. Can we make that work?"`,
    "Client says too expensive": `1. Don't apologize for pricing
2. Ask: "What would make this work for you?"
3. Offer a bundle if available (bundle = better value)
4. If still stuck: "I hear you. Let me talk to the attorney — he might have options. When can I circle back?"`,
    "Client ready to proceed": `1. "Great! Here's what happens next: You'll sign our engagement letter and fee agreement."
2. Offer payment options: "You can pay full upfront, 50/50 split, or three payments over two months. Which works?"
3. Engagement letter + invoice go together (always)
4. "Once we have your signature and payment, we get started immediately."`,
  },
};

// =============================================================================
// Main
// =============================================================================

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Seeding LFL service catalog...\n");

  // ---------------------------------------------------------------
  // 1. Services (upsert by firm_id + slug)
  // ---------------------------------------------------------------
  const serviceRows = SERVICES.map((s) => ({
    firm_id: LFL_FIRM_ID,
    name: s.name,
    slug: s.slug,
    category: s.category,
    standard_price: s.standard_price,
    floor_price: s.floor_price,
    filing_fee: s.filing_fee ?? null,
    status: "active",
  }));

  const { error: svcErr } = await supabase
    .from("services")
    .upsert(serviceRows, { onConflict: "firm_id,slug" });

  if (svcErr) {
    console.error("Failed to seed services:", svcErr.message);
    process.exit(1);
  }
  console.log(`1. Seeded ${SERVICES.length} services`);

  // ---------------------------------------------------------------
  // 2. Resolve service IDs for bundle references
  // ---------------------------------------------------------------
  const { data: svcRows, error: fetchErr } = await supabase
    .from("services")
    .select("id, slug")
    .eq("firm_id", LFL_FIRM_ID);

  if (fetchErr || !svcRows) {
    console.error("Failed to fetch services:", fetchErr?.message);
    process.exit(1);
  }

  const slugToId = new Map(svcRows.map((r) => [r.slug, r.id]));

  // ---------------------------------------------------------------
  // 3. Bundles (upsert by firm_id + slug)
  // ---------------------------------------------------------------
  const bundleRows = BUNDLES.map((b) => {
    const serviceIds = b.service_slugs
      .map((s) => slugToId.get(s))
      .filter((id): id is string => id != null);

    if (serviceIds.length !== b.service_slugs.length) {
      const missing = b.service_slugs.filter((s) => !slugToId.has(s));
      console.warn(`  Warning: bundle "${b.name}" references unknown slugs: ${missing.join(", ")}`);
    }

    return {
      firm_id: LFL_FIRM_ID,
      name: b.name,
      slug: b.slug,
      bundle_price: b.bundle_price,
      floor_price: b.floor_price,
      service_ids: serviceIds,
      active: true,
    };
  });

  const { error: bundleErr } = await supabase
    .from("service_bundles")
    .upsert(bundleRows, { onConflict: "firm_id,slug" });

  if (bundleErr) {
    console.error("Failed to seed bundles:", bundleErr.message);
    process.exit(1);
  }
  console.log(`2. Seeded ${BUNDLES.length} bundles`);

  // ---------------------------------------------------------------
  // 4. Discount tiers (upsert by firm_id + engagement_threshold)
  // ---------------------------------------------------------------
  const tierRows = DISCOUNT_TIERS.map((t) => ({
    firm_id: LFL_FIRM_ID,
    engagement_threshold: t.engagement_threshold,
    discount_amount: t.discount_amount,
    active: true,
  }));

  const { error: tierErr } = await supabase
    .from("discount_tiers")
    .upsert(tierRows, { onConflict: "firm_id,engagement_threshold" });

  if (tierErr) {
    console.error("Failed to seed discount tiers:", tierErr.message);
    process.exit(1);
  }
  console.log(`3. Seeded ${DISCOUNT_TIERS.length} discount tiers`);

  // ---------------------------------------------------------------
  // 5. Negotiation config (firm_config)
  // ---------------------------------------------------------------
  const { error: cfgErr } = await supabase.from("firm_config").upsert(
    {
      firm_id: LFL_FIRM_ID,
      key: "negotiation_config",
      value: NEGOTIATION_CONFIG,
    },
    { onConflict: "firm_id,key" }
  );

  if (cfgErr) {
    console.error("Failed to seed negotiation config:", cfgErr.message);
    process.exit(1);
  }
  console.log("4. Seeded negotiation config in firm_config");

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------
  console.log("\nService catalog seed complete.");
  console.log(`  ${SERVICES.length} services, ${BUNDLES.length} bundles, ${DISCOUNT_TIERS.length} tiers`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
