/**
 * Cross-tenant RLS verification tests.
 *
 * These tests are MANDATORY for CI — a cross-tenant data leak is the worst
 * possible bug this platform can have.
 *
 * Requires a live Supabase instance with migrations applied.
 * Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
 * SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * What these tests do:
 * 1. Create two firms (A and B) with one user each via service_role
 * 2. Seed all tables with per-firm test data
 * 3. Authenticate as user A, verify they CANNOT see firm B's data
 * 4. Verify immutable tables reject UPDATE/DELETE
 * 5. Verify webhook_events with null firm_id are invisible to all users
 * 6. Clean up test data (immutable rows and firms persist — unique IDs per run)
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

// Seeded entity IDs (pre-generated so we can reference them in FK chains)
const STAGE_A_ID = randomUUID();
const STAGE_B_ID = randomUUID();
const CONTACT_A_ID = randomUUID();
const CONTACT_B_ID = randomUUID();
const LEAD_A_ID = randomUUID();
const LEAD_B_ID = randomUUID();
const AI_JOB_A_ID = randomUUID();
const AI_JOB_B_ID = randomUUID();
const CLASSIFICATION_A_ID = randomUUID();
const CLASSIFICATION_B_ID = randomUUID();
const MATTER_A_ID = randomUUID();
const MATTER_B_ID = randomUUID();
const HISTORY_A_ID = randomUUID();
const HISTORY_B_ID = randomUUID();
const CONVERSATION_A_ID = randomUUID();
const CONVERSATION_B_ID = randomUUID();
const MESSAGE_A_ID = randomUUID();
const MESSAGE_B_ID = randomUUID();
const INTEGRATION_A_ID = randomUUID();
const INTEGRATION_B_ID = randomUUID();
const WEBHOOK_NULL_ID = randomUUID();
const WEBHOOK_A_ID = randomUUID();
const WEBHOOK_B_ID = randomUUID();
const SERVICE_A_ID = randomUUID();
const SERVICE_B_ID = randomUUID();
const BUNDLE_A_ID = randomUUID();
const BUNDLE_B_ID = randomUUID();
const TIER_A_ID = randomUUID();
const TIER_B_ID = randomUUID();

// Week 4 (migration 00004) IDs
const APPROVAL_QUEUE_A_ID = randomUUID();
const APPROVAL_QUEUE_B_ID = randomUUID();
const APPROVAL_A_ID = randomUUID();
const APPROVAL_B_ID = randomUUID();
const JURISDICTION_A_ID = randomUUID();
const JURISDICTION_B_ID = randomUUID();
const FEE_QUOTE_A_ID = randomUUID();
const FEE_QUOTE_B_ID = randomUUID();
const ENGAGEMENT_LETTER_A_ID = randomUUID();
const ENGAGEMENT_LETTER_B_ID = randomUUID();
const INVOICE_A_ID = randomUUID();
const INVOICE_B_ID = randomUUID();
const SYNC_STATE_A_ID = randomUUID();
const SYNC_STATE_B_ID = randomUUID();
const DRIP_CAMPAIGN_A_ID = randomUUID();
const DRIP_CAMPAIGN_B_ID = randomUUID();
const DRIP_TEMPLATE_A_ID = randomUUID();
const DRIP_TEMPLATE_B_ID = randomUUID();
const SCHEDULED_ACTION_A_ID = randomUUID();
const SCHEDULED_ACTION_B_ID = randomUUID();

let admin: SupabaseClient;
let userAId: string;
let userBId: string;

// Cache signed-in clients to avoid rate limiting
const sessionCache = new Map<string, SupabaseClient>();

function createAnonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const cached = sessionCache.get(email);
  if (cached) return cached;

  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  sessionCache.set(email, client);
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

    // ---- Week 2 table seeds (ordered by FK dependencies) ----

    // pipeline_stages
    const { error: stgAErr } = await admin.from("pipeline_stages").insert({
      id: STAGE_A_ID, firm_id: FIRM_A_ID, name: "Intake A", slug: `intake-a-${SUFFIX}`,
      display_order: 1, stage_type: "intake",
    });
    if (stgAErr) throw new Error(`Stage A: ${stgAErr.message}`);

    const { error: stgBErr } = await admin.from("pipeline_stages").insert({
      id: STAGE_B_ID, firm_id: FIRM_B_ID, name: "Intake B", slug: `intake-b-${SUFFIX}`,
      display_order: 1, stage_type: "intake",
    });
    if (stgBErr) throw new Error(`Stage B: ${stgBErr.message}`);

    // contacts
    const { error: ctAErr } = await admin.from("contacts").insert({
      id: CONTACT_A_ID, firm_id: FIRM_A_ID, full_name: "Contact A",
    });
    if (ctAErr) throw new Error(`Contact A: ${ctAErr.message}`);

    const { error: ctBErr } = await admin.from("contacts").insert({
      id: CONTACT_B_ID, firm_id: FIRM_B_ID, full_name: "Contact B",
    });
    if (ctBErr) throw new Error(`Contact B: ${ctBErr.message}`);

    // leads
    const { error: ldAErr } = await admin.from("leads").insert({
      id: LEAD_A_ID, firm_id: FIRM_A_ID, source: "manual", status: "new",
      full_name: "Lead A", contact_id: CONTACT_A_ID,
    });
    if (ldAErr) throw new Error(`Lead A: ${ldAErr.message}`);

    const { error: ldBErr } = await admin.from("leads").insert({
      id: LEAD_B_ID, firm_id: FIRM_B_ID, source: "manual", status: "new",
      full_name: "Lead B", contact_id: CONTACT_B_ID,
    });
    if (ldBErr) throw new Error(`Lead B: ${ldBErr.message}`);

    // ai_jobs
    const { error: ajAErr } = await admin.from("ai_jobs").insert({
      id: AI_JOB_A_ID, firm_id: FIRM_A_ID, model: "haiku", purpose: "classify",
      status: "completed",
    });
    if (ajAErr) throw new Error(`AI Job A: ${ajAErr.message}`);

    const { error: ajBErr } = await admin.from("ai_jobs").insert({
      id: AI_JOB_B_ID, firm_id: FIRM_B_ID, model: "haiku", purpose: "classify",
      status: "completed",
    });
    if (ajBErr) throw new Error(`AI Job B: ${ajBErr.message}`);

    // classifications
    const { error: clAErr } = await admin.from("classifications").insert({
      id: CLASSIFICATION_A_ID, firm_id: FIRM_A_ID, lead_id: LEAD_A_ID,
      matter_type: "estate_planning", confidence: 0.95, model: "haiku",
      ai_job_id: AI_JOB_A_ID, is_current: true,
    });
    if (clAErr) throw new Error(`Classification A: ${clAErr.message}`);

    const { error: clBErr } = await admin.from("classifications").insert({
      id: CLASSIFICATION_B_ID, firm_id: FIRM_B_ID, lead_id: LEAD_B_ID,
      matter_type: "estate_planning", confidence: 0.90, model: "haiku",
      ai_job_id: AI_JOB_B_ID, is_current: true,
    });
    if (clBErr) throw new Error(`Classification B: ${clBErr.message}`);

    // matters
    const { error: mtAErr } = await admin.from("matters").insert({
      id: MATTER_A_ID, firm_id: FIRM_A_ID, contact_id: CONTACT_A_ID,
      lead_id: LEAD_A_ID, stage_id: STAGE_A_ID, status: "active",
    });
    if (mtAErr) throw new Error(`Matter A: ${mtAErr.message}`);

    const { error: mtBErr } = await admin.from("matters").insert({
      id: MATTER_B_ID, firm_id: FIRM_B_ID, contact_id: CONTACT_B_ID,
      lead_id: LEAD_B_ID, stage_id: STAGE_B_ID, status: "active",
    });
    if (mtBErr) throw new Error(`Matter B: ${mtBErr.message}`);

    // matter_stage_history
    const { error: mhAErr } = await admin.from("matter_stage_history").insert({
      id: HISTORY_A_ID, firm_id: FIRM_A_ID, matter_id: MATTER_A_ID,
      to_stage_id: STAGE_A_ID, actor_id: userAId, reason: "initial",
    });
    if (mhAErr) throw new Error(`History A: ${mhAErr.message}`);

    const { error: mhBErr } = await admin.from("matter_stage_history").insert({
      id: HISTORY_B_ID, firm_id: FIRM_B_ID, matter_id: MATTER_B_ID,
      to_stage_id: STAGE_B_ID, actor_id: userBId, reason: "initial",
    });
    if (mhBErr) throw new Error(`History B: ${mhBErr.message}`);

    // conversations
    const { error: cvAErr } = await admin.from("conversations").insert({
      id: CONVERSATION_A_ID, firm_id: FIRM_A_ID, lead_id: LEAD_A_ID,
      status: "active", phase: "initial_contact",
    });
    if (cvAErr) throw new Error(`Conversation A: ${cvAErr.message}`);

    const { error: cvBErr } = await admin.from("conversations").insert({
      id: CONVERSATION_B_ID, firm_id: FIRM_B_ID, lead_id: LEAD_B_ID,
      status: "active", phase: "initial_contact",
    });
    if (cvBErr) throw new Error(`Conversation B: ${cvBErr.message}`);

    // messages
    const { error: msgAErr } = await admin.from("messages").insert({
      id: MESSAGE_A_ID, firm_id: FIRM_A_ID, conversation_id: CONVERSATION_A_ID,
      direction: "inbound", sender_type: "contact", content: "Hello A",
    });
    if (msgAErr) throw new Error(`Message A: ${msgAErr.message}`);

    const { error: msgBErr } = await admin.from("messages").insert({
      id: MESSAGE_B_ID, firm_id: FIRM_B_ID, conversation_id: CONVERSATION_B_ID,
      direction: "inbound", sender_type: "contact", content: "Hello B",
    });
    if (msgBErr) throw new Error(`Message B: ${msgBErr.message}`);

    // integration_accounts
    const { error: iaAErr } = await admin.from("integration_accounts").insert({
      id: INTEGRATION_A_ID, firm_id: FIRM_A_ID, provider: "postmark",
      credentials: { api_key: "test_a" },
    });
    if (iaAErr) throw new Error(`Integration A: ${iaAErr.message}`);

    const { error: iaBErr } = await admin.from("integration_accounts").insert({
      id: INTEGRATION_B_ID, firm_id: FIRM_B_ID, provider: "postmark",
      credentials: { api_key: "test_b" },
    });
    if (iaBErr) throw new Error(`Integration B: ${iaBErr.message}`);

    // services
    const { error: svcAErr } = await admin.from("services").insert({
      id: SERVICE_A_ID, firm_id: FIRM_A_ID, name: "Test Service A",
      slug: `test-svc-a-${SUFFIX}`, category: "estate_planning",
      standard_price: 500, floor_price: 400,
    });
    if (svcAErr) throw new Error(`Service A: ${svcAErr.message}`);

    const { error: svcBErr } = await admin.from("services").insert({
      id: SERVICE_B_ID, firm_id: FIRM_B_ID, name: "Test Service B",
      slug: `test-svc-b-${SUFFIX}`, category: "estate_planning",
      standard_price: 500, floor_price: 400,
    });
    if (svcBErr) throw new Error(`Service B: ${svcBErr.message}`);

    // service_bundles
    const { error: bndAErr } = await admin.from("service_bundles").insert({
      id: BUNDLE_A_ID, firm_id: FIRM_A_ID, name: "Test Bundle A",
      slug: `test-bnd-a-${SUFFIX}`, bundle_price: 900, floor_price: 700,
      service_ids: [SERVICE_A_ID],
    });
    if (bndAErr) throw new Error(`Bundle A: ${bndAErr.message}`);

    const { error: bndBErr } = await admin.from("service_bundles").insert({
      id: BUNDLE_B_ID, firm_id: FIRM_B_ID, name: "Test Bundle B",
      slug: `test-bnd-b-${SUFFIX}`, bundle_price: 900, floor_price: 700,
      service_ids: [SERVICE_B_ID],
    });
    if (bndBErr) throw new Error(`Bundle B: ${bndBErr.message}`);

    // discount_tiers
    const { error: trAErr } = await admin.from("discount_tiers").insert({
      id: TIER_A_ID, firm_id: FIRM_A_ID,
      engagement_threshold: 3000, discount_amount: 500,
    });
    if (trAErr) throw new Error(`Tier A: ${trAErr.message}`);

    const { error: trBErr } = await admin.from("discount_tiers").insert({
      id: TIER_B_ID, firm_id: FIRM_B_ID,
      engagement_threshold: 3000, discount_amount: 500,
    });
    if (trBErr) throw new Error(`Tier B: ${trBErr.message}`);

    // webhook_events: null firm_id, firm A, firm B
    const { error: whNullErr } = await admin.from("webhook_events").insert({
      id: WEBHOOK_NULL_ID, provider: "dialpad", event_type: "call.ended",
      payload: { test: true }, status: "received",
      idempotency_key: `wh-null-${SUFFIX}`,
    });
    if (whNullErr) throw new Error(`Webhook null: ${whNullErr.message}`);

    const { error: whAErr } = await admin.from("webhook_events").insert({
      id: WEBHOOK_A_ID, firm_id: FIRM_A_ID, provider: "dialpad",
      event_type: "call.ended", payload: { firm: "a" }, status: "processed",
      idempotency_key: `wh-a-${SUFFIX}`,
    });
    if (whAErr) throw new Error(`Webhook A: ${whAErr.message}`);

    const { error: whBErr } = await admin.from("webhook_events").insert({
      id: WEBHOOK_B_ID, firm_id: FIRM_B_ID, provider: "dialpad",
      event_type: "call.ended", payload: { firm: "b" }, status: "processed",
      idempotency_key: `wh-b-${SUFFIX}`,
    });
    if (whBErr) throw new Error(`Webhook B: ${whBErr.message}`);

    // ---- Week 4 table seeds (migration 00004) ----

    // approval_queue
    const { error: aqAErr } = await admin.from("approval_queue").insert({
      id: APPROVAL_QUEUE_A_ID, firm_id: FIRM_A_ID, entity_type: "fee_quote",
      entity_id: randomUUID(), action_type: "fee_quote", priority: 1,
    });
    if (aqAErr) throw new Error(`ApprovalQueue A: ${aqAErr.message}`);

    const { error: aqBErr } = await admin.from("approval_queue").insert({
      id: APPROVAL_QUEUE_B_ID, firm_id: FIRM_B_ID, entity_type: "fee_quote",
      entity_id: randomUUID(), action_type: "fee_quote", priority: 1,
    });
    if (aqBErr) throw new Error(`ApprovalQueue B: ${aqBErr.message}`);

    // approvals (immutable)
    const { error: apAErr } = await admin.from("approvals").insert({
      id: APPROVAL_A_ID, firm_id: FIRM_A_ID, queue_item_id: APPROVAL_QUEUE_A_ID,
      decision: "approved", decided_by: userAId,
    });
    if (apAErr) throw new Error(`Approval A: ${apAErr.message}`);

    const { error: apBErr } = await admin.from("approvals").insert({
      id: APPROVAL_B_ID, firm_id: FIRM_B_ID, queue_item_id: APPROVAL_QUEUE_B_ID,
      decision: "approved", decided_by: userBId,
    });
    if (apBErr) throw new Error(`Approval B: ${apBErr.message}`);

    // jurisdictions
    const { error: jAErr } = await admin.from("jurisdictions").insert({
      id: JURISDICTION_A_ID, firm_id: FIRM_A_ID, state_code: `TX-${SUFFIX}`,
      state_name: "Texas", iolta_account_type: "trust", earning_method: "milestone",
    });
    if (jAErr) throw new Error(`Jurisdiction A: ${jAErr.message}`);

    const { error: jBErr } = await admin.from("jurisdictions").insert({
      id: JURISDICTION_B_ID, firm_id: FIRM_B_ID, state_code: `TX-${SUFFIX}`,
      state_name: "Texas", iolta_account_type: "trust", earning_method: "milestone",
    });
    if (jBErr) throw new Error(`Jurisdiction B: ${jBErr.message}`);

    // fee_quotes
    const { error: fqAErr } = await admin.from("fee_quotes").insert({
      id: FEE_QUOTE_A_ID, firm_id: FIRM_A_ID, matter_id: MATTER_A_ID,
      line_items: [{ service: "test", price: 500 }], subtotal: 500,
      total_quoted_fee: 500, floor_total: 400,
    });
    if (fqAErr) throw new Error(`FeeQuote A: ${fqAErr.message}`);

    const { error: fqBErr } = await admin.from("fee_quotes").insert({
      id: FEE_QUOTE_B_ID, firm_id: FIRM_B_ID, matter_id: MATTER_B_ID,
      line_items: [{ service: "test", price: 500 }], subtotal: 500,
      total_quoted_fee: 500, floor_total: 400,
    });
    if (fqBErr) throw new Error(`FeeQuote B: ${fqBErr.message}`);

    // engagement_letters
    const { error: elAErr } = await admin.from("engagement_letters").insert({
      id: ENGAGEMENT_LETTER_A_ID, firm_id: FIRM_A_ID, matter_id: MATTER_A_ID,
      fee_quote_id: FEE_QUOTE_A_ID, variables: { client: "Test A" },
    });
    if (elAErr) throw new Error(`EngagementLetter A: ${elAErr.message}`);

    const { error: elBErr } = await admin.from("engagement_letters").insert({
      id: ENGAGEMENT_LETTER_B_ID, firm_id: FIRM_B_ID, matter_id: MATTER_B_ID,
      fee_quote_id: FEE_QUOTE_B_ID, variables: { client: "Test B" },
    });
    if (elBErr) throw new Error(`EngagementLetter B: ${elBErr.message}`);

    // invoices
    const { error: invAErr } = await admin.from("invoices").insert({
      id: INVOICE_A_ID, firm_id: FIRM_A_ID, matter_id: MATTER_A_ID,
      fee_quote_id: FEE_QUOTE_A_ID, amount: 500,
    });
    if (invAErr) throw new Error(`Invoice A: ${invAErr.message}`);

    const { error: invBErr } = await admin.from("invoices").insert({
      id: INVOICE_B_ID, firm_id: FIRM_B_ID, matter_id: MATTER_B_ID,
      fee_quote_id: FEE_QUOTE_B_ID, amount: 500,
    });
    if (invBErr) throw new Error(`Invoice B: ${invBErr.message}`);

    // integration_sync_state
    const { error: ssAErr } = await admin.from("integration_sync_state").insert({
      id: SYNC_STATE_A_ID, firm_id: FIRM_A_ID,
      integration_account_id: INTEGRATION_A_ID, sync_type: "email_poll",
    });
    if (ssAErr) throw new Error(`SyncState A: ${ssAErr.message}`);

    const { error: ssBErr } = await admin.from("integration_sync_state").insert({
      id: SYNC_STATE_B_ID, firm_id: FIRM_B_ID,
      integration_account_id: INTEGRATION_B_ID, sync_type: "email_poll",
    });
    if (ssBErr) throw new Error(`SyncState B: ${ssBErr.message}`);

    // drip_campaigns
    const { error: dcAErr } = await admin.from("drip_campaigns").insert({
      id: DRIP_CAMPAIGN_A_ID, firm_id: FIRM_A_ID, name: "Follow-up A",
      slug: `followup-a-${SUFFIX}`, trigger_event: "lead_created",
    });
    if (dcAErr) throw new Error(`DripCampaign A: ${dcAErr.message}`);

    const { error: dcBErr } = await admin.from("drip_campaigns").insert({
      id: DRIP_CAMPAIGN_B_ID, firm_id: FIRM_B_ID, name: "Follow-up B",
      slug: `followup-b-${SUFFIX}`, trigger_event: "lead_created",
    });
    if (dcBErr) throw new Error(`DripCampaign B: ${dcBErr.message}`);

    // drip_templates
    const { error: dtAErr } = await admin.from("drip_templates").insert({
      id: DRIP_TEMPLATE_A_ID, firm_id: FIRM_A_ID,
      campaign_id: DRIP_CAMPAIGN_A_ID, name: "Day 1 SMS A",
      channel: "sms", body_template: "Hi {{name}}, following up.",
    });
    if (dtAErr) throw new Error(`DripTemplate A: ${dtAErr.message}`);

    const { error: dtBErr } = await admin.from("drip_templates").insert({
      id: DRIP_TEMPLATE_B_ID, firm_id: FIRM_B_ID,
      campaign_id: DRIP_CAMPAIGN_B_ID, name: "Day 1 SMS B",
      channel: "sms", body_template: "Hi {{name}}, following up.",
    });
    if (dtBErr) throw new Error(`DripTemplate B: ${dtBErr.message}`);

    // scheduled_actions
    const { error: saAErr } = await admin.from("scheduled_actions").insert({
      id: SCHEDULED_ACTION_A_ID, firm_id: FIRM_A_ID,
      campaign_id: DRIP_CAMPAIGN_A_ID, template_id: DRIP_TEMPLATE_A_ID,
      matter_id: MATTER_A_ID, scheduled_for: new Date(Date.now() + 86400000).toISOString(),
    });
    if (saAErr) throw new Error(`ScheduledAction A: ${saAErr.message}`);

    const { error: saBErr } = await admin.from("scheduled_actions").insert({
      id: SCHEDULED_ACTION_B_ID, firm_id: FIRM_B_ID,
      campaign_id: DRIP_CAMPAIGN_B_ID, template_id: DRIP_TEMPLATE_B_ID,
      matter_id: MATTER_B_ID, scheduled_for: new Date(Date.now() + 86400000).toISOString(),
    });
    if (saBErr) throw new Error(`ScheduledAction B: ${saBErr.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;

    // Clean up in reverse FK order. Immutable tables and firms persist due to
    // triggers and ON DELETE RESTRICT — each test run uses unique IDs so this is safe.

    // Week 4 tables (reverse FK order)
    await admin.from("scheduled_actions").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("drip_templates").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("drip_campaigns").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("integration_sync_state").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("invoices").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("engagement_letters").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("fee_quotes").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("jurisdictions").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    // approvals are immutable (can't delete) — unique IDs per run
    await admin.from("approval_queue").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);

    // Week 2-3 tables
    await admin.from("service_bundles").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("services").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("discount_tiers").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("messages").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("conversations").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("matters").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("leads").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("contacts").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("pipeline_stages").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("integration_accounts").delete().in("firm_id", [FIRM_A_ID, FIRM_B_ID]);
    await admin.from("webhook_events").delete().in("id", [WEBHOOK_NULL_ID, WEBHOOK_A_ID, WEBHOOK_B_ID]);
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

  // ====================================================================
  // Week 2 tables — cross-tenant isolation
  // ====================================================================

  // ---- pipeline_stages ----

  it("user A can see firm A pipeline stages", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("pipeline_stages").select("id").eq("id", STAGE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B pipeline stages", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("pipeline_stages").select("id").eq("id", STAGE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- contacts ----

  it("user A can see firm A contacts", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("contacts").select("id").eq("id", CONTACT_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B contacts", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("contacts").select("id").eq("id", CONTACT_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- leads ----

  it("user A can see firm A leads", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("leads").select("id").eq("id", LEAD_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B leads", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("leads").select("id").eq("id", LEAD_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- ai_jobs ----

  it("user A can see firm A AI jobs", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("ai_jobs").select("id").eq("id", AI_JOB_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B AI jobs", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("ai_jobs").select("id").eq("id", AI_JOB_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- classifications ----

  it("user A can see firm A classifications", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("classifications").select("id").eq("id", CLASSIFICATION_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B classifications", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("classifications").select("id").eq("id", CLASSIFICATION_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- matters ----

  it("user A can see firm A matters", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("matters").select("id").eq("id", MATTER_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B matters", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("matters").select("id").eq("id", MATTER_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- conversations ----

  it("user A can see firm A conversations", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("conversations").select("id").eq("id", CONVERSATION_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B conversations", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("conversations").select("id").eq("id", CONVERSATION_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- messages ----

  it("user A can see firm A messages", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("messages").select("id").eq("id", MESSAGE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B messages", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("messages").select("id").eq("id", MESSAGE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- integration_accounts ----

  it("user A can see firm A integration accounts", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("integration_accounts").select("id").eq("id", INTEGRATION_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B integration accounts", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("integration_accounts").select("id").eq("id", INTEGRATION_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- webhook_events ----

  it("user A can see firm A webhook events", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("webhook_events").select("id").eq("id", WEBHOOK_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B webhook events", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("webhook_events").select("id").eq("id", WEBHOOK_B_ID);
    expect(data).toHaveLength(0);
  });

  it("webhook_events with null firm_id not visible to user A", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("webhook_events").select("id").eq("id", WEBHOOK_NULL_ID);
    expect(data).toHaveLength(0);
  });

  it("webhook_events with null firm_id not visible to user B", async () => {
    const client = await signInAs(USER_B_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("webhook_events").select("id").eq("id", WEBHOOK_NULL_ID);
    expect(data).toHaveLength(0);
  });

  // ====================================================================
  // Week 2 tables — immutability
  // ====================================================================

  it("classifications UPDATE is blocked", async () => {
    const { error } = await admin
      .from("classifications")
      .update({ matter_type: "tampered" })
      .eq("id", CLASSIFICATION_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("classifications DELETE is blocked", async () => {
    const { error } = await admin
      .from("classifications")
      .delete()
      .eq("id", CLASSIFICATION_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("ai_jobs UPDATE is blocked", async () => {
    const { error } = await admin
      .from("ai_jobs")
      .update({ model: "tampered" })
      .eq("id", AI_JOB_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("ai_jobs DELETE is blocked", async () => {
    const { error } = await admin
      .from("ai_jobs")
      .delete()
      .eq("id", AI_JOB_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("matter_stage_history UPDATE is blocked", async () => {
    const { error } = await admin
      .from("matter_stage_history")
      .update({ reason: "tampered" })
      .eq("id", HISTORY_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("matter_stage_history DELETE is blocked", async () => {
    const { error } = await admin
      .from("matter_stage_history")
      .delete()
      .eq("id", HISTORY_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  // ====================================================================
  // Service catalog — cross-tenant isolation
  // ====================================================================

  // ---- services ----

  it("user A can see firm A services", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("services").select("id").eq("id", SERVICE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B services", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("services").select("id").eq("id", SERVICE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- service_bundles ----

  it("user A can see firm A bundles", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("service_bundles").select("id").eq("id", BUNDLE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B bundles", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("service_bundles").select("id").eq("id", BUNDLE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- discount_tiers ----

  it("user A can see firm A discount tiers", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("discount_tiers").select("id").eq("id", TIER_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B discount tiers", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("discount_tiers").select("id").eq("id", TIER_B_ID);
    expect(data).toHaveLength(0);
  });

  // ====================================================================
  // Migration 00004 — approval workflow, fees, invoices, drip engine
  // ====================================================================

  // ---- approval_queue ----

  it("user A can see firm A approval queue", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("approval_queue").select("id").eq("id", APPROVAL_QUEUE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B approval queue", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("approval_queue").select("id").eq("id", APPROVAL_QUEUE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- approvals ----

  it("user A can see firm A approvals", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("approvals").select("id").eq("id", APPROVAL_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B approvals", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("approvals").select("id").eq("id", APPROVAL_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- jurisdictions ----

  it("user A can see firm A jurisdictions", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("jurisdictions").select("id").eq("id", JURISDICTION_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B jurisdictions", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("jurisdictions").select("id").eq("id", JURISDICTION_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- fee_quotes ----

  it("user A can see firm A fee quotes", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("fee_quotes").select("id").eq("id", FEE_QUOTE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B fee quotes", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("fee_quotes").select("id").eq("id", FEE_QUOTE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- engagement_letters ----

  it("user A can see firm A engagement letters", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("engagement_letters").select("id").eq("id", ENGAGEMENT_LETTER_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B engagement letters", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("engagement_letters").select("id").eq("id", ENGAGEMENT_LETTER_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- invoices ----

  it("user A can see firm A invoices", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("invoices").select("id").eq("id", INVOICE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B invoices", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("invoices").select("id").eq("id", INVOICE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- integration_sync_state ----

  it("user A can see firm A sync state", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("integration_sync_state").select("id").eq("id", SYNC_STATE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B sync state", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("integration_sync_state").select("id").eq("id", SYNC_STATE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- drip_campaigns ----

  it("user A can see firm A drip campaigns", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("drip_campaigns").select("id").eq("id", DRIP_CAMPAIGN_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B drip campaigns", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("drip_campaigns").select("id").eq("id", DRIP_CAMPAIGN_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- drip_templates ----

  it("user A can see firm A drip templates", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("drip_templates").select("id").eq("id", DRIP_TEMPLATE_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B drip templates", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("drip_templates").select("id").eq("id", DRIP_TEMPLATE_B_ID);
    expect(data).toHaveLength(0);
  });

  // ---- scheduled_actions ----

  it("user A can see firm A scheduled actions", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("scheduled_actions").select("id").eq("id", SCHEDULED_ACTION_A_ID);
    expect(data).toHaveLength(1);
  });

  it("user A CANNOT see firm B scheduled actions", async () => {
    const client = await signInAs(USER_A_EMAIL, TEST_PASSWORD);
    const { data } = await client.from("scheduled_actions").select("id").eq("id", SCHEDULED_ACTION_B_ID);
    expect(data).toHaveLength(0);
  });

  // ====================================================================
  // Migration 00004 — immutability
  // ====================================================================

  it("approvals UPDATE is blocked", async () => {
    const { error } = await admin
      .from("approvals")
      .update({ reason: "tampered" })
      .eq("id", APPROVAL_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });

  it("approvals DELETE is blocked", async () => {
    const { error } = await admin
      .from("approvals")
      .delete()
      .eq("id", APPROVAL_A_ID);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("append-only");
  });
});
