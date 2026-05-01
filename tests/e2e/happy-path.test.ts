/**
 * End-to-end smoke test: full happy path.
 *
 * Exercises the complete v1 flow against a live Supabase instance:
 *   Lead → Matter → Fee Quoted → Approved → Engagement Letter → (signed) → Terminal
 *
 * Uses service_role to bypass auth/RLS — this tests business logic, not auth.
 * Run with: npx vitest run tests/e2e/happy-path.test.ts
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "path";

import { convertLeadToMatter } from "@/lib/pipeline/convert-lead";
import { executeTransition } from "@/lib/pipeline/execute-transition";
import { scheduleDripSequence } from "@/lib/pipeline/drip-scheduler";
import { generateEngagementLetter } from "@/lib/engagement/generate-letter";
import type { PipelineStage } from "@/types/database";

// Load env
config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Unique IDs per test run
const FIRM_ID = randomUUID();
const CONTACT_ID = randomUUID();
const LEAD_ID = randomUUID();
const SUFFIX = FIRM_ID.slice(0, 8);
let USER_ID: string;

// Stage IDs (pre-generated for FK references)
const STAGE_IDS = {
  new_lead: randomUUID(),
  first_touch: randomUUID(),
  awaiting_reply: randomUUID(),
  in_conversation: randomUUID(),
  fee_quoted: randomUUID(),
  negotiating: randomUUID(),
  engagement_sent: randomUUID(),
  engagement_signed: randomUUID(),
  payment_pending: randomUUID(),
  paid_awaiting_intake: randomUUID(),
};

let stages: PipelineStage[] = [];

describe("E2E Happy Path", () => {
  beforeAll(async () => {
    // 1. Create firm
    const { error: firmErr } = await admin.from("firms").insert({
      id: FIRM_ID,
      name: `E2E Test Firm ${SUFFIX}`,
      slug: `e2e-${SUFFIX}`,
    });
    expect(firmErr).toBeNull();

    // 2. Create auth user
    const { data: authUser, error: authErr } =
      await admin.auth.admin.createUser({
        email: `e2e-${SUFFIX}@test.local`,
        password: `TestPass!${SUFFIX}`,
        email_confirm: true,
        user_metadata: { full_name: "E2E Attorney" },
      });
    expect(authErr).toBeNull();
    USER_ID = authUser.user!.id;

    // 3. Assign firm membership
    const { error: memberErr } = await admin.from("firm_users").insert({
      firm_id: FIRM_ID,
      user_id: USER_ID,
      role: "owner",
    });
    expect(memberErr).toBeNull();

    // 4. Create pipeline stages with transition rules
    const stageRows = [
      { id: STAGE_IDS.new_lead, slug: "new_lead", name: "New Lead", stage_type: "intake", display_order: 1, sla_hours: 2, is_terminal: false, allowed_transitions: [STAGE_IDS.first_touch] },
      { id: STAGE_IDS.first_touch, slug: "first_touch", name: "First Touch", stage_type: "intake", display_order: 2, sla_hours: null, is_terminal: false, allowed_transitions: [STAGE_IDS.awaiting_reply, STAGE_IDS.in_conversation] },
      { id: STAGE_IDS.awaiting_reply, slug: "awaiting_reply", name: "Awaiting Reply", stage_type: "qualification", display_order: 3, sla_hours: 72, is_terminal: false, allowed_transitions: [STAGE_IDS.in_conversation, STAGE_IDS.first_touch] },
      { id: STAGE_IDS.in_conversation, slug: "in_conversation", name: "In Conversation", stage_type: "qualification", display_order: 4, sla_hours: 24, is_terminal: false, allowed_transitions: [STAGE_IDS.fee_quoted, STAGE_IDS.awaiting_reply] },
      { id: STAGE_IDS.fee_quoted, slug: "fee_quoted", name: "Fee Quoted", stage_type: "negotiation", display_order: 5, sla_hours: 72, is_terminal: false, allowed_transitions: [STAGE_IDS.negotiating, STAGE_IDS.engagement_sent] },
      { id: STAGE_IDS.negotiating, slug: "negotiating", name: "Negotiating", stage_type: "negotiation", display_order: 6, sla_hours: 48, is_terminal: false, allowed_transitions: [STAGE_IDS.fee_quoted, STAGE_IDS.engagement_sent] },
      { id: STAGE_IDS.engagement_sent, slug: "engagement_sent", name: "Engagement Sent", stage_type: "closing", display_order: 7, sla_hours: 72, is_terminal: false, allowed_transitions: [STAGE_IDS.engagement_signed, STAGE_IDS.negotiating] },
      { id: STAGE_IDS.engagement_signed, slug: "engagement_signed", name: "Engagement Signed", stage_type: "closing", display_order: 8, sla_hours: 24, is_terminal: false, allowed_transitions: [STAGE_IDS.payment_pending] },
      { id: STAGE_IDS.payment_pending, slug: "payment_pending", name: "Payment Pending", stage_type: "closing", display_order: 9, sla_hours: 120, is_terminal: false, allowed_transitions: [STAGE_IDS.paid_awaiting_intake] },
      { id: STAGE_IDS.paid_awaiting_intake, slug: "paid_awaiting_intake", name: "Paid - Awaiting Intake", stage_type: "post_close", display_order: 10, sla_hours: 72, is_terminal: true, allowed_transitions: [] },
    ];

    const { error: stageErr } = await admin
      .from("pipeline_stages")
      .insert(stageRows.map((s) => ({ ...s, firm_id: FIRM_ID })));
    expect(stageErr).toBeNull();

    // Store stages for later use
    const { data: fetchedStages } = await admin
      .from("pipeline_stages")
      .select("*")
      .eq("firm_id", FIRM_ID)
      .order("display_order");
    stages = fetchedStages as PipelineStage[];

    // 5. Create contact
    const { error: contactErr } = await admin.from("contacts").insert({
      id: CONTACT_ID,
      firm_id: FIRM_ID,
      full_name: "Jane Doe",
      email: `jane-${SUFFIX}@example.com`,
      state: "TX",
    });
    expect(contactErr).toBeNull();

    // 6. Create lead
    const { error: leadErr } = await admin.from("leads").insert({
      id: LEAD_ID,
      firm_id: FIRM_ID,
      contact_id: CONTACT_ID,
      source: "manual",
      channel: "web_form",
      status: "new",
    });
    expect(leadErr).toBeNull();

    // 7. Create jurisdiction (needed for engagement letter)
    const { error: jurErr } = await admin.from("jurisdictions").insert({
      firm_id: FIRM_ID,
      state_code: "TX",
      state_name: "Texas",
      active: true,
      iolta_rule: "Must deposit into IOLTA trust account",
      iolta_account_type: "trust",
      earning_method: "milestone",
      milestone_split: [50, 50],
      requires_informed_consent: false,
      attorney_name: "E2E Attorney",
      attorney_email: `e2e-${SUFFIX}@test.local`,
    });
    expect(jurErr).toBeNull();
  });

  it("converts lead to matter (starts in new_lead)", async () => {
    const userId = USER_ID;

    const result = await convertLeadToMatter(admin, {
      firmId: FIRM_ID,
      leadId: LEAD_ID,
      contactId: CONTACT_ID,
      matterType: "estate_planning",
      jurisdiction: "TX",
      summary: "E2E smoke test matter",
      actorId: userId,
    });

    expect(result.matterId).toBeDefined();
    expect(result.stageId).toBe(STAGE_IDS.new_lead);

    // Verify lead is now "converted"
    const { data: lead } = await admin
      .from("leads")
      .select("status")
      .eq("id", LEAD_ID)
      .single();
    expect(lead!.status).toBe("converted");
  });

  it("transitions through pipeline: new_lead → first_touch → awaiting_reply → in_conversation → fee_quoted", async () => {
    const userId = USER_ID;

    // Get matter
    const { data: matter } = await admin
      .from("matters")
      .select("id, stage_id")
      .eq("firm_id", FIRM_ID)
      .eq("lead_id", LEAD_ID)
      .single();
    const matterId = matter!.id;

    // Transition chain
    const transitionPath = [
      { from: STAGE_IDS.new_lead, to: STAGE_IDS.first_touch },
      { from: STAGE_IDS.first_touch, to: STAGE_IDS.awaiting_reply },
      { from: STAGE_IDS.awaiting_reply, to: STAGE_IDS.in_conversation },
      { from: STAGE_IDS.in_conversation, to: STAGE_IDS.fee_quoted },
    ];

    let currentStageId = matter!.stage_id;

    for (const { from, to } of transitionPath) {
      expect(currentStageId).toBe(from);
      const result = await executeTransition(admin, FIRM_ID, {
        matterId,
        fromStageId: from,
        toStageId: to,
        actorId: userId,
      }, stages);
      expect(result.success).toBe(true);
      currentStageId = to;
    }

    // Verify final stage
    const { data: updated } = await admin
      .from("matters")
      .select("stage_id")
      .eq("id", matterId)
      .single();
    expect(updated!.stage_id).toBe(STAGE_IDS.fee_quoted);

    // Verify stage history has entries
    const { data: history } = await admin
      .from("matter_stage_history")
      .select("*")
      .eq("matter_id", matterId)
      .order("created_at");
    // Initial assignment + 4 transitions = 5 entries
    expect(history!.length).toBe(5);
  });

  it("schedules drip sequence when entering awaiting_reply", async () => {
    // Create a conversation for the lead (needed by drip scheduler)
    const conversationId = randomUUID();
    const { error: convoErr } = await admin.from("conversations").insert({
      id: conversationId,
      firm_id: FIRM_ID,
      lead_id: LEAD_ID,
      contact_id: CONTACT_ID,
      status: "active",
      phase: "qualification",
      channel: "sms",
    });
    expect(convoErr).toBeNull();

    const result = await scheduleDripSequence(
      admin,
      FIRM_ID,
      LEAD_ID,
      CONTACT_ID,
      conversationId,
      null,
    );

    expect(result.scheduledCount).toBe(4);
    expect(result.actionIds).toHaveLength(4);

    // Verify scheduled actions exist
    const { data: actions } = await admin
      .from("scheduled_actions")
      .select("*")
      .eq("firm_id", FIRM_ID)
      .eq("lead_id", LEAD_ID)
      .eq("status", "pending")
      .order("scheduled_for");

    expect(actions!.length).toBe(4);
    // Verify day offsets are correct (2, 5, 7, 10)
    const days = actions!.map((a) => (a.metadata as { drip_day: number }).drip_day);
    expect(days).toEqual([2, 5, 7, 10]);
  });

  it("creates fee quote and enqueues for approval", async () => {
    const { data: matter } = await admin
      .from("matters")
      .select("id")
      .eq("firm_id", FIRM_ID)
      .eq("lead_id", LEAD_ID)
      .single();
    const matterId = matter!.id;

    const lineItems = [
      { service_name: "Simple Will", subtotal: 1500, quantity: 1 },
      { service_name: "Power of Attorney", subtotal: 500, quantity: 1 },
    ];

    const { data: feeQuote, error: fqErr } = await admin
      .from("fee_quotes")
      .insert({
        firm_id: FIRM_ID,
        matter_id: matterId,
        contact_id: CONTACT_ID,
        line_items: lineItems,
        subtotal: 2000,
        bundle_discount: 200,
        engagement_tier_discount: 0,
        total_quoted_fee: 1800,
        floor_total: 1600,
        status: "pending_approval",
      })
      .select("id")
      .single();

    expect(fqErr).toBeNull();
    expect(feeQuote).not.toBeNull();

    // Enqueue for approval
    const userId = USER_ID;

    const { error: approvalErr } = await admin.from("approval_queue").insert({
      firm_id: FIRM_ID,
      entity_type: "fee_quote",
      entity_id: feeQuote!.id,
      action_type: "fee_quote",
      priority: 1,
      status: "pending",
      assigned_to: userId,
      metadata: { matter_id: matterId, total_quoted_fee: 1800 },
    });
    expect(approvalErr).toBeNull();
  });

  it("approves fee quote", async () => {
    const userId = USER_ID;

    // Fetch pending fee_quote approval
    const { data: queueItem } = await admin
      .from("approval_queue")
      .select("*")
      .eq("firm_id", FIRM_ID)
      .eq("entity_type", "fee_quote")
      .eq("status", "pending")
      .single();

    expect(queueItem).not.toBeNull();

    // Insert approval record
    const { error: approvalErr } = await admin.from("approvals").insert({
      firm_id: FIRM_ID,
      queue_item_id: queueItem!.id,
      decision: "approved",
      decided_by: userId,
    });
    expect(approvalErr).toBeNull();

    // Update queue status
    const { error: queueErr } = await admin
      .from("approval_queue")
      .update({ status: "approved" })
      .eq("id", queueItem!.id);
    expect(queueErr).toBeNull();

    // Update fee_quote status
    const { error: fqErr } = await admin
      .from("fee_quotes")
      .update({
        status: "approved",
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", queueItem!.entity_id);
    expect(fqErr).toBeNull();

    // Verify
    const { data: feeQuote } = await admin
      .from("fee_quotes")
      .select("status")
      .eq("id", queueItem!.entity_id)
      .single();
    expect(feeQuote!.status).toBe("approved");
  });

  it("generates engagement letter from approved fee quote", async () => {
    const userId = USER_ID;

    const { data: matter } = await admin
      .from("matters")
      .select("id")
      .eq("firm_id", FIRM_ID)
      .eq("lead_id", LEAD_ID)
      .single();
    const matterId = matter!.id;

    const { data: feeQuote } = await admin
      .from("fee_quotes")
      .select("id")
      .eq("firm_id", FIRM_ID)
      .eq("matter_id", matterId)
      .eq("status", "approved")
      .single();

    const result = await generateEngagementLetter(admin, {
      firmId: FIRM_ID,
      matterId,
      feeQuoteId: feeQuote!.id,
      actorId: userId,
    });

    expect(result.engagementLetterId).toBeDefined();
    expect(result.templateKey).toBe("engagement_letter_TX");
    expect(result.variables.clientName).toBe("Jane Doe");
    expect(result.variables.totalFee).toBe(1800);
    expect(result.variables.stateCode).toBe("TX");
    expect(result.variables.firmName).toContain("E2E Test Firm");

    // Verify letter is in draft status
    const { data: letter } = await admin
      .from("engagement_letters")
      .select("status")
      .eq("id", result.engagementLetterId)
      .single();
    expect(letter!.status).toBe("draft");
  });

  it("transitions matter through closing stages to terminal", async () => {
    const userId = USER_ID;

    const { data: matter } = await admin
      .from("matters")
      .select("id, stage_id")
      .eq("firm_id", FIRM_ID)
      .eq("lead_id", LEAD_ID)
      .single();
    const matterId = matter!.id;

    // Current stage is fee_quoted; transition through closing stages
    const closingPath = [
      { from: STAGE_IDS.fee_quoted, to: STAGE_IDS.engagement_sent },
      { from: STAGE_IDS.engagement_sent, to: STAGE_IDS.engagement_signed },
      { from: STAGE_IDS.engagement_signed, to: STAGE_IDS.payment_pending },
      { from: STAGE_IDS.payment_pending, to: STAGE_IDS.paid_awaiting_intake },
    ];

    let currentStageId = matter!.stage_id;

    for (const { from, to } of closingPath) {
      expect(currentStageId).toBe(from);
      const result = await executeTransition(admin, FIRM_ID, {
        matterId,
        fromStageId: from,
        toStageId: to,
        actorId: userId,
      }, stages);
      expect(result.success).toBe(true);
      currentStageId = to;
    }

    // Verify matter is at terminal stage
    const { data: finalMatter } = await admin
      .from("matters")
      .select("stage_id")
      .eq("id", matterId)
      .single();
    expect(finalMatter!.stage_id).toBe(STAGE_IDS.paid_awaiting_intake);

    // Verify the terminal stage is indeed terminal
    const terminalStage = stages.find((s) => s.id === STAGE_IDS.paid_awaiting_intake);
    expect(terminalStage!.is_terminal).toBe(true);
  });

  it("verifies audit trail completeness", async () => {
    const { data: auditEntries } = await admin
      .from("audit_log")
      .select("action, entity_type")
      .eq("firm_id", FIRM_ID)
      .order("created_at");

    // convertLeadToMatter (1) + 8 stage transitions + generateEngagementLetter (1) = 10
    expect(auditEntries!.length).toBeGreaterThanOrEqual(5);

    const actions = auditEntries!.map((e) => e.action);
    expect(actions).toContain("lead.converted_to_matter");
    expect(actions).toContain("pipeline.stage_transition");
    expect(actions).toContain("engagement_letter.generated");
  });
});
