/**
 * fix-firm-config-models.ts — Correct AI model IDs in firm_config for LFL
 *
 * The seed-lfl.ts script shipped with drifted model ID strings. This script
 * upserts the canonical IDs so the AI layer resolves the right models at
 * runtime.
 *
 * Correct values (as of 2026-05-09):
 *   ai.classification_model → claude-haiku-4-5-20251001
 *   ai.conversation_model   → claude-sonnet-4-6
 *   ai.escalation_model     → claude-opus-4-7
 *
 * Usage:
 *   npx tsx scripts/fix-firm-config-models.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent — uses upsert on (firm_id, key).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

const MODEL_UPDATES = [
  { key: "ai.classification_model", value: "claude-haiku-4-5-20251001" },
  { key: "ai.conversation_model", value: "claude-sonnet-4-6" },
  { key: "ai.escalation_model", value: "claude-opus-4-7" },
] as const;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Fixing AI model IDs in firm_config for LFL...\n");

  // Fetch current values so we can print before/after
  const { data: existing, error: fetchErr } = await supabase
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", LFL_FIRM_ID)
    .in(
      "key",
      MODEL_UPDATES.map((m) => m.key)
    );

  if (fetchErr) {
    console.error("Failed to fetch current values:", fetchErr.message);
    process.exit(1);
  }

  const before: Record<string, unknown> = {};
  for (const row of existing ?? []) {
    before[row.key] = row.value;
  }

  // Upsert each model key
  for (const { key: configKey, value: configValue } of MODEL_UPDATES) {
    const { error } = await supabase
      .from("firm_config")
      .upsert(
        { firm_id: LFL_FIRM_ID, key: configKey, value: configValue },
        { onConflict: "firm_id,key" }
      );

    if (error) {
      console.error(`Failed to upsert "${configKey}":`, error.message);
      process.exit(1);
    }

    const prev = before[configKey] ?? "(not set)";
    console.log(`  ${configKey}`);
    console.log(`    before: ${JSON.stringify(prev)}`);
    console.log(`    after:  ${JSON.stringify(configValue)}`);
  }

  console.log("\nDone. AI model IDs are now canonical.");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
