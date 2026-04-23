/**
 * Cross-tenant RLS verification tests.
 *
 * These tests are MANDATORY for CI — a cross-tenant data leak is the worst
 * possible bug this platform can have.
 *
 * Requires a live Supabase instance with the foundation migration applied.
 * Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
 * SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * What these tests do:
 * 1. Create two firms (A and B) with one user each via service_role
 * 2. Authenticate as user A, verify they CANNOT see firm B's data
 * 3. Authenticate as user B, verify they CANNOT see firm A's data
 * 4. Verify audit_log UPDATE/DELETE are blocked at the trigger level
 * 5. Clean up test data (audit_log and firms are left in place due to
 *    immutability triggers and ON DELETE RESTRICT — each run uses unique IDs)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "path";

// Load env
config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Unique IDs per test run — no collisions between runs
const FIRM_A_ID = randomUUID();
const FIRM_B_ID = randomUUID();
const SUFFIX = FIRM_A_ID.slice(0, 8);
const USER_A_EMAIL = `rls-a-${SUFFIX}@test.local`;
const USER_B_EMAIL = `rls-b-${SUFFIX}@test.local`;
const TEST_PASSWORD = `TestPass!${SUFFIX}`;

let admin: SupabaseClient;
let userAId: string;
let userBId: string;

function createAnonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

describe("Cross-tenant RLS", () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      throw new Error(
        "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL, " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create two firms
    const { error: firmAErr } = await admin
      .from("firms")
      .insert({ id: FIRM_A_ID, name: "RLS Test Firm A", slug: `rls-a-${SUFFIX}` });
    if (firmAErr) throw new Error(`Firm A: ${firmAErr.message}`);

    const { error: firmBErr } = await admin
      .from("firms")
      .insert({ id: FIRM_B_ID, name: "RLS Test Firm B", slug: `rls-b-${SUFFIX}` });
    if (firmBErr) throw new Error(`Firm B: ${firmBErr.message}`);

    // Create two auth users (triggers public.users row via handle_new_user)
    const { data: uA, error: uAErr } = await admin.auth.admin.createUser({
      email: USER_A_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Test User A" },
    });
    if (uAErr) throw new Error(`User A: ${uAErr.message}`);
    userAId = uA.user.id;

    const { data: uB, error: uBErr } = await admin.auth.admin.createUser({
      email: USER_B_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Test User B" },
    });
    if (uBErr) throw new Error(`User B: ${uBErr.message}`);
    userBId = uB.user.id;

    // Assign firm memberships: A→firmA, B→firmB
    const { error: mAErr } = await admin
      .from("firm_users")
      .insert({ firm_id: FIRM_A_ID, user_id: userAId, role: "attorney" });
    if (mAErr) throw new Error(`Membership A: ${mAErr.message}`);

    const { error: mBErr } = await admin
      .from("firm_users")
      .insert({ firm_id: FIRM_B_ID, user_id: userBId, role: "attorney" });
    if (mBErr) throw new Error(`Membership B: ${mBErr.message}`);

    // Seed firm_config for each firm
    const { error: cfgAErr } = await admin
      .from("firm_config")
      .insert({ firm_id: FIRM_A_ID, key: "test_key", value: "firm_a_value" });
    if (cfgAErr) throw new Error(`Config A: ${cfgAErr.message}`);

    const { error: cfgBErr } = await admin
      .from("firm_config")
      .insert({ firm_id: FIRM_B_ID, key: "test_key", value: "firm_b_value" });
    if (cfgBErr) throw new Error(`Config B: ${cfgBErr.message}`);

    // Seed audit_log entries via the hash-chain function
    const { error: auditAErr } = await admin.rpc("insert_audit_log", {
      p_firm_id: FIRM_A_ID,
      p_actor_id: userAId,
      p_action: "test.created",
      p_entity_type: "test",
      p_entity_id: FIRM_A_ID,
    });
    if (auditAErr) throw new Error(`Audit A: ${auditAErr.message}`);

    const { error: auditBErr } = await admin.rpc("insert_audit_log", {
      p_firm_id: FIRM_B_ID,
      p_actor_id: userBId,
      p_action: "test.created",
      p_entity_type: "test",
      p_entity_id: FIRM_B_ID,
    });
    if (auditBErr) throw new Error(`Audit B: ${auditBErr.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;

    // Clean up what we can. audit_log rows and firms persist due to
    // immutability triggers and ON DELETE RESTRICT — each test run uses
    // unique IDs so this is safe.
    await admin.from("firm_config").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("firm_users").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);

    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }, 15_000);

  // ---- firms ----

  it("user A can see firm A", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firms").select("id").eq("id", FIRM_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firms").select("id").eq("id", FIRM_B_ID);
    expect(data).toHaveLength(0);
  });

  it("user B CANNOT see firm A", async () => {
    const client = await signInAs(USER_B_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firms").select("id").eq("id", FIRM_A_ID);
    expect(data).toHaveLength(0);
  });

  // ---- firm_users ----

  it("user A can see firm A memberships", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firm_users").select("id").eq("firm_id", FIRM_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B memberships", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firm_users").select("id").eq("firm_id", FIRM_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- firm_config ----

  it("user A can see firm A config", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firm_config").select("key").eq("firm_id", FIRM_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B config", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("firm_config").select("key").eq("firm_id", FIRM_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- audit_log ----

  it("user A can see firm A audit log", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("audit_log").select("id").eq("firm_id", FIRM_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B audit log", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("audit_log").select("id").eq("firm_id", FIRM_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- users (colleague visibility) ----

  it("user A can see themselves", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("users").select("id").eq("id", userAId);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see user B (different firm)", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("users").select("id").eq("id", userBId);
    expect(data).toHaveLength(0);
  });

  // ---- audit_log immutability ----

  it("audit_log UPDATE is blocked", async () => {
    const { error } = await admin
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("firm_id", FIRM_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("audit_log DELETE is blocked", async () => {
    const { error } = await admin
      .from("audit_log")
      .delete()
      .eq("firm_id", FIRM_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });
});
