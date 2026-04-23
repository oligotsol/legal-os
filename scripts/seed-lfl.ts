/**
 * seed-lfl.ts — Full seed for Legacy First Law (tenant #1)
 *
 * Creates the auth user, firm, firm_config, firm_users membership,
 * and genesis audit_log entry.
 *
 * Usage:
 *   npx tsx scripts/seed-lfl.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   LFL_SEED_USER_EMAIL (optional, defaults to garrison@legacyfirstlaw.local)
 *   LFL_SEED_USER_PASSWORD (optional, defaults to a random password)
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local from project root
config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

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

  const email =
    process.env.LFL_SEED_USER_EMAIL || "garrison@legacyfirstlaw.local";
  const password =
    process.env.LFL_SEED_USER_PASSWORD || randomBytes(24).toString("base64url");

  console.log("Seeding LFL...\n");

  // ---------------------------------------------------------------
  // 1. Firm
  // ---------------------------------------------------------------
  const { error: firmError } = await supabase.from("firms").upsert(
    {
      id: LFL_FIRM_ID,
      name: "Legacy First Law",
      slug: "legacy-first-law",
      status: "active",
    },
    { onConflict: "id" }
  );

  if (firmError) {
    console.error("Failed to insert firm:", firmError.message);
    process.exit(1);
  }
  console.log("1. Firm created: Legacy First Law");

  // ---------------------------------------------------------------
  // 2. Firm config
  // ---------------------------------------------------------------
  const configs = [
    { key: "timezone", value: "America/Chicago" },
    { key: "practice_areas", value: ["estate_planning"] },
    { key: "ai.classification_model", value: "claude-haiku-4-5-20251001" },
    { key: "ai.conversation_model", value: "claude-sonnet-4-6-20250514" },
    { key: "ai.escalation_model", value: "claude-opus-4-6-20250610" },
  ];

  for (const { key, value } of configs) {
    const { error } = await supabase.from("firm_config").upsert(
      { firm_id: LFL_FIRM_ID, key, value },
      { onConflict: "firm_id,key" }
    );
    if (error) {
      console.error(`Failed to insert config "${key}":`, error.message);
      process.exit(1);
    }
  }
  console.log("2. Firm config created (5 entries)");

  // ---------------------------------------------------------------
  // 3. Auth user (creates public.users via auth trigger)
  // ---------------------------------------------------------------
  // Check if user already exists
  const { data: existingUsers } =
    await supabase.auth.admin.listUsers({ perPage: 1000 });

  const existingUser = existingUsers?.users?.find(
    (u: { email?: string }) => u.email === email
  );
  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    console.log(`3. Auth user already exists: ${email} (${userId})`);
  } else {
    const { data: newUser, error: userError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Garrison" },
      });

    if (userError) {
      console.error("Failed to create auth user:", userError.message);
      process.exit(1);
    }

    userId = newUser.user.id;
    console.log(`3. Auth user created: ${email} (${userId})`);
    console.log(`   Password: ${password}`);
  }

  // ---------------------------------------------------------------
  // 4. Firm membership
  // ---------------------------------------------------------------
  const { error: memberError } = await supabase.from("firm_users").upsert(
    {
      firm_id: LFL_FIRM_ID,
      user_id: userId,
      role: "owner",
    },
    { onConflict: "firm_id,user_id" }
  );

  if (memberError) {
    console.error("Failed to insert firm_users:", memberError.message);
    process.exit(1);
  }
  console.log("4. Firm membership created: owner");

  // ---------------------------------------------------------------
  // 5. Genesis audit log entry
  // ---------------------------------------------------------------
  // Check if chain already has entries for this firm
  const { count } = await supabase
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", LFL_FIRM_ID);

  if (count && count > 0) {
    console.log("5. Audit log chain already exists, skipping genesis");
  } else {
    const { error: auditError } = await supabase.rpc("insert_audit_log", {
      p_firm_id: LFL_FIRM_ID,
      p_actor_id: userId,
      p_action: "firm.created",
      p_entity_type: "firm",
      p_entity_id: LFL_FIRM_ID,
      p_before: null,
      p_after: { name: "Legacy First Law", slug: "legacy-first-law" },
      p_metadata: { source: "seed" },
    });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError.message);
      process.exit(1);
    }
    console.log("5. Audit log genesis entry created");
  }

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------
  console.log("\nSeed complete.");
  console.log(`\nLogin credentials:`);
  console.log(`  Email:    ${email}`);
  if (!existingUser) {
    console.log(`  Password: ${password}`);
  }
  console.log(`  URL:      ${url}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
