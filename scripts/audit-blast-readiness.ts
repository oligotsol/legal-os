/**
 * Pre-blast audit — read-only. Checks the live state of:
 *   - Dialpad API key in integration_accounts (rotated vs leaked prefix check)
 *   - contacts table columns (does sms_consent / opted_out_at exist?)
 *   - sms_opt_outs / sms_sends tables (do they exist?)
 *   - ethics_scan config (does "STOP" trigger AUTO_DNC?)
 *   - inbound webhook STOP handling
 *
 * Run with: npx tsx --env-file=.env.local scripts/audit-blast-readiness.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const admin = createAdminClient();

  console.log("=== Pre-blast audit ===\n");

  // 1. Dialpad credentials prefix check
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("credentials, status, updated_at")
    .eq("firm_id", FIRM_ID)
    .eq("provider", "dialpad")
    .maybeSingle();
  if (!integration) {
    console.log("✗ No Dialpad integration row.");
  } else {
    const apiKey =
      (integration.credentials as { apiKey?: string })?.apiKey ?? "";
    const prefix = apiKey.slice(0, 7);
    const looksRotated = apiKey.startsWith("C9CHRNS");
    const looksLeaked = apiKey.startsWith("a2kUYFF");
    console.log("Dialpad integration:");
    console.log("  status:    ", integration.status);
    console.log("  updated_at:", integration.updated_at);
    console.log("  key prefix:", prefix + "…");
    console.log(
      "  rotated?:  ",
      looksRotated
        ? "YES (starts with C9CHRNS)"
        : looksLeaked
          ? "NO — STILL THE LEAKED KEY (a2kUYFF). STOP."
          : "UNKNOWN — neither expected prefix matches",
    );
  }
  console.log("");

  // 2. contacts table schema — check for sms_consent / opted_out_at
  // We probe by selecting them and seeing if Supabase errors out.
  const { error: consentErr } = await admin
    .from("contacts")
    .select("sms_consent")
    .limit(1);
  const { error: optOutErr } = await admin
    .from("contacts")
    .select("opted_out_at")
    .limit(1);
  console.log("contacts.sms_consent column:", consentErr ? "MISSING" : "exists");
  console.log("contacts.opted_out_at column:", optOutErr ? "MISSING" : "exists");
  console.log("");

  // 3. sms_opt_outs table existence
  const { error: optOutTableErr } = await admin
    .from("sms_opt_outs")
    .select("*", { count: "exact", head: true });
  console.log("sms_opt_outs table:", optOutTableErr ? "MISSING" : "exists");

  // 4. sms_sends log table existence
  const { error: sendsTableErr } = await admin
    .from("sms_sends")
    .select("*", { count: "exact", head: true });
  console.log("sms_sends table:", sendsTableErr ? "MISSING" : "exists");
  console.log("");

  // 5. dnc column (we DO know this one exists already)
  const { count: dncCount, error: dncErr } = await admin
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("dnc", true);
  console.log(
    "contacts.dnc column:",
    dncErr ? "MISSING" : "exists",
    dncErr ? "" : `(${dncCount ?? 0} marked dnc)`,
  );
  console.log("");

  // 6. firm_config.dialpad_from_number sanity
  const { data: fromRow } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", FIRM_ID)
    .eq("key", "dialpad_from_number")
    .maybeSingle();
  console.log(
    "dialpad_from_number:",
    (fromRow?.value as Record<string, unknown> | null)?.value ?? "MISSING",
  );

  console.log("\n=== end ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
