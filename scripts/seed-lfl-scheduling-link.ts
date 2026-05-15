/**
 * Seed firm_config.scheduling_config.calendar_link for LFL. Idempotent —
 * preserves any other keys already on the scheduling_config row.
 *
 *   npx tsx --env-file=.env.local scripts/seed-lfl-scheduling-link.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";
const CALENDAR_LINK =
  "https://calendar.google.com/appointments/schedules/AcZssZ23NDagFIdB1pGpdDPu5eaYeUo4O7Mxj5jYfQZxzcSlpazwtgpuS0Gv2juIl3406UIUNfsCpP3d";

async function main() {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", FIRM_ID)
    .eq("key", "scheduling_config")
    .maybeSingle();

  const prev = (existing?.value ?? {}) as Record<string, unknown>;
  const next = {
    ...prev,
    calendar_link: CALENDAR_LINK,
    provider: "google_appointments",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("firm_config")
    .upsert(
      { firm_id: FIRM_ID, key: "scheduling_config", value: next },
      { onConflict: "firm_id,key" },
    )
    .select("id, key");

  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }

  console.log("✓ scheduling_config seeded for LFL");
  console.log("  row:", data);
  console.log("  calendar_link:", CALENDAR_LINK);
  console.log("");
  console.log(
    "Test it: open the power dialer, click Send calendar invite on a lead. The prospect will receive a text/email with the booking link.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
