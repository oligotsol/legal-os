/**
 * Diagnostic: inspect the firm's Gmail integration_accounts row and the
 * dispatch-side firm_config to find out why the "Send" button isn't actually
 * sending email.
 *
 *   npx tsx --env-file=.env.local scripts/check-email-integration.ts
 *
 * Reports (no credential values, just shape + status):
 *   - whether an integration row exists for gmail
 *   - its status (active / inactive / error)
 *   - which credential keys are present (clientId / clientSecret / refreshToken)
 *   - whether the refresh token still works (live token exchange)
 *   - whether gmail_from_address is configured on firm_config
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { getAccessToken } from "../src/lib/integrations/gmail/email";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const admin = createAdminClient();

  console.log("Inspecting firm:", FIRM_ID);
  console.log("");

  // 1. integration_accounts
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("id, provider, status, credentials, created_at")
    .eq("firm_id", FIRM_ID)
    .eq("provider", "gmail")
    .maybeSingle();

  if (!integration) {
    console.log("✗ NO Gmail integration row exists for this firm.");
    console.log("  → Dispatch will throw at getIntegrationAccount, message gets marked 'failed'.");
    console.log("  → Fix: run the Gmail OAuth setup flow to create the row.");
    process.exit(0);
  }

  console.log("✓ Gmail integration row exists");
  console.log("  id:        ", integration.id);
  console.log("  status:    ", integration.status);
  console.log("  created_at:", integration.created_at);
  const creds = (integration.credentials ?? {}) as Record<string, unknown>;
  console.log(
    "  credential keys present:",
    Object.keys(creds).filter((k) => !!creds[k]).join(", "),
  );
  console.log("");

  if (integration.status !== "active") {
    console.log(`✗ status is "${integration.status}", not "active".`);
    console.log("  → Dispatch falls back to dry-run; messages get external_id=dry_run_<ts>");
    console.log("  → Fix: UPDATE integration_accounts SET status='active' WHERE id='" + integration.id + "'");
    console.log("    AFTER verifying credentials work (token-exchange test below).");
    console.log("");
  }

  // 2. firm_config — gmail_from_address
  const { data: configRow } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", FIRM_ID)
    .eq("key", "gmail_from_address")
    .maybeSingle();

  if (!configRow) {
    console.log("✗ firm_config.gmail_from_address NOT set.");
    console.log("  → Dispatch resolves from='' → Gmail API rejects → marked 'failed'.");
    console.log("  → Fix: insert a firm_config row keyed 'gmail_from_address' with value {value:'<gmail@address>'}");
  } else {
    const val = (configRow.value as Record<string, unknown>)?.value;
    console.log("✓ firm_config.gmail_from_address is set:", val ?? "(missing 'value' key)");
  }
  console.log("");

  // 3. Live token exchange — proves the refresh token is still valid
  const clientId = creds.clientId as string | undefined;
  const clientSecret = creds.clientSecret as string | undefined;
  const refreshToken = creds.refreshToken as string | undefined;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log("✗ Missing OAuth fields in credentials.");
    console.log("  needed: clientId, clientSecret, refreshToken");
    process.exit(0);
  }
  console.log("Testing refresh-token exchange against Google...");
  try {
    const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
    console.log("✓ Refresh token works. Access token length:", accessToken.length);
    console.log("  → OAuth side is healthy.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log("✗ Token exchange FAILED:", msg.slice(0, 400));
    console.log("  → Refresh token is expired/revoked.");
    console.log("  → Fix: re-run the Gmail OAuth flow to mint a fresh refresh_token.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
