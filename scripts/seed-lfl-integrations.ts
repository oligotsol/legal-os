/**
 * seed-lfl-integrations.ts — Seed LFL integration accounts + dispatch config
 *
 * Sets up:
 *   1. Dialpad integration account (SMS) — requires DIALPAD_API_KEY env var
 *   2. Gmail integration account (email) — placeholder, inactive until OAuth
 *   3. firm_config: dialpad_from_number, gmail_from_address
 *
 * Usage:
 *   DIALPAD_API_KEY=xxx npx tsx scripts/seed-lfl-integrations.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * DIALPAD_API_KEY must be passed as an env var — never committed to code.
 *
 * Idempotent — uses upsert on unique constraints (firm_id, provider)
 * and (firm_id, key).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dialpadApiKey = process.env.DIALPAD_API_KEY;

  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  if (!dialpadApiKey) {
    console.error(
      "Missing DIALPAD_API_KEY env var. Pass it inline:\n" +
        "  DIALPAD_API_KEY=xxx npx tsx scripts/seed-lfl-integrations.ts"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Seeding LFL integration accounts...\n");

  // -------------------------------------------------------------------
  // 1. Dialpad integration account (active)
  // -------------------------------------------------------------------
  const { error: dialpadErr } = await supabase
    .from("integration_accounts")
    .upsert(
      {
        firm_id: LFL_FIRM_ID,
        provider: "dialpad",
        credentials: {
          apiKey: dialpadApiKey,
        },
        status: "active",
        config: {
          user_id: "5993153960484864",
          api_base_url: "https://dialpad.com/api/v2",
        },
      },
      { onConflict: "firm_id,provider" }
    );

  if (dialpadErr) {
    console.error("Failed to seed Dialpad account:", dialpadErr.message);
    process.exit(1);
  }
  console.log("1. Dialpad integration account — active");

  // -------------------------------------------------------------------
  // 2. Gmail integration account (inactive — needs OAuth consent flow)
  // -------------------------------------------------------------------
  const { error: gmailErr } = await supabase
    .from("integration_accounts")
    .upsert(
      {
        firm_id: LFL_FIRM_ID,
        provider: "gmail",
        credentials: {},
        status: "inactive",
        config: {
          note: "Needs OAuth consent flow with Garrison. See DEVELOPER_HANDOFF Section 2.",
          from_address: "garrison@legacyfirstlaw.com",
        },
      },
      { onConflict: "firm_id,provider" }
    );

  if (gmailErr) {
    console.error("Failed to seed Gmail account:", gmailErr.message);
    process.exit(1);
  }
  console.log("2. Gmail integration account — inactive (pending OAuth)");

  // -------------------------------------------------------------------
  // 3. firm_config: dialpad_from_number
  //    Garrison has 9 lines — set a placeholder until he sends the list.
  //    The dispatch layer reads: firm_config[dialpad_from_number].value
  // -------------------------------------------------------------------
  const { error: fromNumErr } = await supabase.from("firm_config").upsert(
    {
      firm_id: LFL_FIRM_ID,
      key: "dialpad_from_number",
      value: {
        value: "+12104047175",
      },
    },
    { onConflict: "firm_id,key" }
  );

  if (fromNumErr) {
    console.error("Failed to seed dialpad_from_number:", fromNumErr.message);
    process.exit(1);
  }
  console.log("3. firm_config: dialpad_from_number — +12104047175");

  // -------------------------------------------------------------------
  // 4. firm_config: gmail_from_address
  // -------------------------------------------------------------------
  const { error: fromEmailErr } = await supabase.from("firm_config").upsert(
    {
      firm_id: LFL_FIRM_ID,
      key: "gmail_from_address",
      value: {
        value: "garrison@legacyfirstlaw.com",
      },
    },
    { onConflict: "firm_id,key" }
  );

  if (fromEmailErr) {
    console.error("Failed to seed gmail_from_address:", fromEmailErr.message);
    process.exit(1);
  }
  console.log("4. firm_config: gmail_from_address — set");

  // -------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------
  console.log("\nIntegration seed complete.");
  console.log("  Dialpad: ACTIVE — SMS dispatch will use live API");
  console.log("  Gmail:   INACTIVE — email dispatch stays in dry-run");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Set up Google OAuth client + run consent flow with Garrison");
  console.log("     → update integration_accounts.gmail with credentials + status=active");
  console.log("  2. Rotate the Dialpad API key (per Garrison's recommendation)");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
