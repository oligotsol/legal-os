/**
 * Seed jurisdiction records for Legacy First Law.
 *
 * Usage: npx tsx scripts/seed-lfl-jurisdictions.ts
 *
 * Upserts jurisdictions for TX (primary), IA, ND, PA, NJ with
 * IOLTA rules, earning methods, milestone splits, and attorney info.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // Get the LFL firm
  const { data: firm, error: firmErr } = await admin
    .from("firms")
    .select("id")
    .eq("slug", "legacy-first-law")
    .single();

  if (firmErr || !firm) {
    console.error("Firm 'legacy-first-law' not found. Run seed:lfl first.");
    process.exit(1);
  }

  const firmId = firm.id;

  const jurisdictions = [
    {
      firm_id: firmId,
      state_code: "TX",
      state_name: "Texas",
      iolta_rule:
        "Texas requires attorneys to deposit client funds into an IOLTA account at an eligible financial institution. Funds must be kept separate from the attorney's own funds.",
      iolta_account_type: "trust" as const,
      earning_method: "milestone" as const,
      milestone_split: [50, 50],
      requires_informed_consent: false,
      attorney_name: "Garrison Cole",
      attorney_email: "garrison@legacyfirstlaw.com",
      notes: "Primary jurisdiction. Most matters originate here.",
      active: true,
    },
    {
      firm_id: firmId,
      state_code: "IA",
      state_name: "Iowa",
      iolta_rule:
        "Iowa requires IOLTA accounts for nominal or short-term client funds. Attorney must provide written disclosure to client.",
      iolta_account_type: "trust" as const,
      earning_method: "earned_upon_receipt" as const,
      milestone_split: null,
      requires_informed_consent: true,
      attorney_name: "Garrison Cole",
      attorney_email: "garrison@legacyfirstlaw.com",
      notes: null,
      active: true,
    },
    {
      firm_id: firmId,
      state_code: "ND",
      state_name: "North Dakota",
      iolta_rule:
        "North Dakota requires client funds to be held in trust. IOLTA participation is mandatory for qualifying deposits.",
      iolta_account_type: "trust" as const,
      earning_method: "milestone" as const,
      milestone_split: [33, 33, 34],
      requires_informed_consent: false,
      attorney_name: "Garrison Cole",
      attorney_email: "garrison@legacyfirstlaw.com",
      notes: null,
      active: true,
    },
    {
      firm_id: firmId,
      state_code: "PA",
      state_name: "Pennsylvania",
      iolta_rule:
        "Pennsylvania requires IOLTA accounts for all nominal or short-term client deposits. Interest earned goes to the IOLTA Board.",
      iolta_account_type: "trust" as const,
      earning_method: "milestone" as const,
      milestone_split: [50, 50],
      requires_informed_consent: true,
      attorney_name: "Garrison Cole",
      attorney_email: "garrison@legacyfirstlaw.com",
      notes: null,
      active: true,
    },
    {
      firm_id: firmId,
      state_code: "NJ",
      state_name: "New Jersey",
      iolta_rule:
        "New Jersey requires attorneys to maintain IOLTA accounts for client funds that are nominal in amount or held for a short period.",
      iolta_account_type: "trust" as const,
      earning_method: "earned_upon_receipt" as const,
      milestone_split: null,
      requires_informed_consent: true,
      attorney_name: "Garrison Cole",
      attorney_email: "garrison@legacyfirstlaw.com",
      notes: null,
      active: true,
    },
  ];

  for (const jur of jurisdictions) {
    const { error } = await admin
      .from("jurisdictions")
      .upsert(jur, { onConflict: "firm_id,state_code" });

    if (error) {
      console.error(`Failed to upsert jurisdiction ${jur.state_code}:`, error.message);
    } else {
      console.log(`Upserted jurisdiction: ${jur.state_code} (${jur.state_name})`);
    }
  }

  console.log("Done.");
}

main().catch(console.error);
