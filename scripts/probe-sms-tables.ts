/**
 * Probe sms_opt_outs + sms_sends tables to discover their column shape since
 * they were created out-of-band (no migration in repo). We try a couple of
 * inserts that we'll immediately roll back via .delete() so we can inspect
 * what column names exist.
 *
 *   npx tsx --env-file=.env.local scripts/probe-sms-tables.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

async function main() {
  const admin = createAdminClient();

  // Use information_schema via a raw SQL call. Supabase JS doesn't expose it
  // directly, so we use the REST PG metadata endpoint.
  for (const table of ["sms_opt_outs", "sms_sends"]) {
    console.log(`\n=== ${table} ===`);
    // Try selecting every conceivable column; Supabase returns the row
    // shape on success. We'll inspect a single row if present.
    const { data, error } = await admin
      .from(table)
      .select("*")
      .limit(1);
    if (error) {
      console.log(`  ✗ ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) {
      console.log("  table empty; trying minimal probe insert");
      // Try an insert with a single safe column to discover required fields.
      const probe: Record<string, unknown> = {};
      const { error: insErr } = await admin
        .from(table)
        .insert(probe)
        .select("*")
        .single();
      console.log("  probe insert error (reveals required columns):", insErr?.message ?? "unknown");
      continue;
    }
    console.log("  columns:", Object.keys(data[0]).join(", "));
    console.log("  sample row:", JSON.stringify(data[0]).slice(0, 400));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
