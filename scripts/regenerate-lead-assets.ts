/**
 * One-off: regenerate the dialer call script + background brief for a single
 * lead (matched by full_name LIKE %arg%, most recent first).
 *
 *   npx tsx scripts/regenerate-lead-assets.ts Ronald
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { generateLeadDialerAssets } from "../src/lib/pipeline/generate-lead-dialer-assets";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: tsx scripts/regenerate-lead-assets.ts <name-fragment>");
    process.exit(1);
  }
  const admin = createAdminClient();

  const { data: leads, error } = await admin
    .from("leads")
    .select("id, full_name, created_at, payload")
    .eq("firm_id", FIRM_ID)
    .is("deleted_at", null)
    .ilike("full_name", `%${name}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  if (!leads || leads.length === 0) {
    console.error(`No leads matching "${name}".`);
    process.exit(1);
  }

  console.log(`Found ${leads.length} match${leads.length === 1 ? "" : "es"}:`);
  for (const l of leads) {
    console.log(`  ${l.id}  ${l.full_name}  created=${l.created_at}`);
  }
  const target = leads[0];
  console.log(`\nRegenerating for: ${target.full_name} (${target.id})`);

  const result = await generateLeadDialerAssets({
    admin,
    firmId: FIRM_ID,
    leadId: target.id,
    force: true,
  });

  console.log(`Done. script=${result.scriptGenerated} brief=${result.briefGenerated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
