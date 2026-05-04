/**
 * Update the Dialpad integration_accounts.credentials.apiKey to a new value.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/update-dialpad-key.ts <new_api_key>
 *
 * The new key value is taken from argv[2] and never logged.
 */

import { createClient } from "@supabase/supabase-js";

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const newKey = process.argv[2];
  if (!newKey || newKey.length < 20) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/update-dialpad-key.ts <new_api_key>");
    console.error("(Pasted argument was missing or too short to be a valid key)");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Read existing credentials so we preserve any other fields (webhookSecret, etc.)
  const { data: existing, error: readErr } = await supabase
    .from("integration_accounts")
    .select("credentials")
    .eq("firm_id", LFL_FIRM_ID)
    .eq("provider", "dialpad")
    .single();

  if (readErr || !existing) {
    console.error("Failed to load Dialpad integration:", readErr?.message);
    process.exit(1);
  }

  const merged = {
    ...(existing.credentials as Record<string, unknown>),
    apiKey: newKey,
  };

  const { error: updateErr } = await supabase
    .from("integration_accounts")
    .update({ credentials: merged })
    .eq("firm_id", LFL_FIRM_ID)
    .eq("provider", "dialpad");

  if (updateErr) {
    console.error("Failed to update credentials:", updateErr.message);
    process.exit(1);
  }

  console.log("Updated Dialpad apiKey for LFL.");
  console.log("New key length:", newKey.length, "characters.");
  console.log("(Key value not echoed for safety.)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
