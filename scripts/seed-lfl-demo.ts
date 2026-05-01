/**
 * seed-lfl-demo.ts — Seed demo data for the full intake-to-engagement flow.
 *
 * Creates:
 *   - 3 leads at different stages (new, qualified, converted)
 *   - Contacts for each lead
 *   - Conversations for each lead
 *   - 1 matter (from the converted lead) at "fee_quoted" stage with an approved fee quote
 *   - 1 classification for the qualified lead
 *
 * This gives a demo-ready state:
 *   - Leads page shows 3 leads
 *   - One lead can be manually converted to a matter
 *   - Pipeline shows a matter ready for engagement letter generation
 *   - The "New Lead" form can be used to create fresh leads
 *
 * Usage:
 *   npx tsx scripts/seed-lfl-demo.ts
 *
 * Prerequisites: Run seed:lfl, seed:lfl-pipeline, seed:lfl-services,
 *   seed:lfl-conversation first.
 *
 * Idempotent — deletes existing demo data and re-creates.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Seeding demo data for Legacy First Law...\n");

  // Get the firm owner's user ID
  const { data: owners } = await admin
    .from("firm_users")
    .select("user_id")
    .eq("firm_id", LFL_FIRM_ID)
    .eq("role", "owner")
    .limit(1);

  if (!owners || owners.length === 0) {
    console.error("No owner found for LFL. Run seed:lfl first.");
    process.exit(1);
  }

  const ownerId = owners[0].user_id;

  // Get pipeline stages
  const { data: stages } = await admin
    .from("pipeline_stages")
    .select("id, slug")
    .eq("firm_id", LFL_FIRM_ID);

  if (!stages || stages.length === 0) {
    console.error("No pipeline stages found. Run seed:lfl-pipeline first.");
    process.exit(1);
  }

  const slugToId = new Map(stages.map((s) => [s.slug, s.id as string]));

  // Get services for fee quote line items
  const { data: services } = await admin
    .from("services")
    .select("id, name, standard_price")
    .eq("firm_id", LFL_FIRM_ID)
    .eq("status", "active")
    .limit(4);

  if (!services || services.length === 0) {
    console.error("No services found. Run seed:lfl-services first.");
    process.exit(1);
  }

  // Get jurisdiction for TX
  const { data: txJurisdiction } = await admin
    .from("jurisdictions")
    .select("id")
    .eq("firm_id", LFL_FIRM_ID)
    .eq("state_code", "TX")
    .maybeSingle();

  // ---------------------------------------------------------------
  // Clean up previous demo data (by channel = "demo")
  // ---------------------------------------------------------------
  console.log("Cleaning up previous demo data...");

  // Delete demo leads and cascaded data
  const { data: demoLeads } = await admin
    .from("leads")
    .select("id")
    .eq("firm_id", LFL_FIRM_ID)
    .eq("channel", "demo");

  if (demoLeads && demoLeads.length > 0) {
    const leadIds = demoLeads.map((l) => l.id);

    // Delete conversations for demo leads
    await admin
      .from("conversations")
      .delete()
      .eq("firm_id", LFL_FIRM_ID)
      .in("lead_id", leadIds);

    // Delete classifications
    await admin
      .from("classifications")
      .delete()
      .eq("firm_id", LFL_FIRM_ID)
      .in("lead_id", leadIds);

    // Delete matters (and their fee quotes, engagement letters, etc.)
    const { data: demoMatters } = await admin
      .from("matters")
      .select("id")
      .eq("firm_id", LFL_FIRM_ID)
      .in("lead_id", leadIds);

    if (demoMatters && demoMatters.length > 0) {
      const matterIds = demoMatters.map((m) => m.id);

      await admin
        .from("engagement_letters")
        .delete()
        .eq("firm_id", LFL_FIRM_ID)
        .in("matter_id", matterIds);

      await admin
        .from("fee_quotes")
        .delete()
        .eq("firm_id", LFL_FIRM_ID)
        .in("matter_id", matterIds);

      await admin
        .from("matter_stage_history")
        .delete()
        .eq("firm_id", LFL_FIRM_ID)
        .in("matter_id", matterIds);

      await admin
        .from("matters")
        .delete()
        .eq("firm_id", LFL_FIRM_ID)
        .in("lead_id", leadIds);
    }

    // Delete contacts created from demo leads
    await admin
      .from("contacts")
      .delete()
      .eq("firm_id", LFL_FIRM_ID)
      .in("source_lead_id", leadIds);

    // Delete leads themselves
    await admin
      .from("leads")
      .delete()
      .eq("firm_id", LFL_FIRM_ID)
      .eq("channel", "demo");
  }

  console.log("  Cleaned.\n");

  // ---------------------------------------------------------------
  // 1. Create contacts
  // ---------------------------------------------------------------

  const contacts = [
    {
      firm_id: LFL_FIRM_ID,
      full_name: "Margaret Thompson",
      email: "margaret.thompson@example.com",
      phone: "+15125551001",
      state: "TX",
      dnc: false,
    },
    {
      firm_id: LFL_FIRM_ID,
      full_name: "Robert Chen",
      email: "robert.chen@example.com",
      phone: "+15125551002",
      state: "TX",
      dnc: false,
    },
    {
      firm_id: LFL_FIRM_ID,
      full_name: "Patricia Williams",
      email: "patricia.williams@example.com",
      phone: "+15125551003",
      state: "IA",
      dnc: false,
    },
  ];

  const { data: insertedContacts, error: contactErr } = await admin
    .from("contacts")
    .insert(contacts)
    .select("id, full_name");

  if (contactErr || !insertedContacts) {
    console.error("Failed to create contacts:", contactErr?.message);
    process.exit(1);
  }

  console.log(`1. Created ${insertedContacts.length} contacts`);

  const [margaret, robert, patricia] = insertedContacts;

  // ---------------------------------------------------------------
  // 2. Create leads
  // ---------------------------------------------------------------

  const leads = [
    {
      firm_id: LFL_FIRM_ID,
      source: "manual" as const,
      status: "new" as const,
      channel: "demo",
      full_name: "Margaret Thompson",
      email: "margaret.thompson@example.com",
      phone: "+15125551001",
      contact_id: margaret.id,
      payload: { notes: "Called about setting up a simple will. Husband recently passed." },
      priority: 5,
      assigned_to: ownerId,
    },
    {
      firm_id: LFL_FIRM_ID,
      source: "referral" as const,
      status: "qualified" as const,
      channel: "demo",
      full_name: "Robert Chen",
      email: "robert.chen@example.com",
      phone: "+15125551002",
      contact_id: robert.id,
      payload: { notes: "Referred by Jim at First National Bank. Needs revocable trust + POA." },
      priority: 7,
      assigned_to: ownerId,
    },
    {
      firm_id: LFL_FIRM_ID,
      source: "manual" as const,
      status: "converted" as const,
      channel: "demo",
      full_name: "Patricia Williams",
      email: "patricia.williams@example.com",
      phone: "+15125551003",
      contact_id: patricia.id,
      payload: { notes: "Walk-in. Iowa resident, needs estate plan. Has 3 children." },
      priority: 5,
      assigned_to: ownerId,
    },
  ];

  const { data: insertedLeads, error: leadErr } = await admin
    .from("leads")
    .insert(leads)
    .select("id, full_name, status");

  if (leadErr || !insertedLeads) {
    console.error("Failed to create leads:", leadErr?.message);
    process.exit(1);
  }

  console.log(`2. Created ${insertedLeads.length} leads`);

  const [margaretLead, robertLead, patriciaLead] = insertedLeads;

  // Update contacts with source_lead_id
  await admin.from("contacts").update({ source_lead_id: margaretLead.id }).eq("id", margaret.id);
  await admin.from("contacts").update({ source_lead_id: robertLead.id }).eq("id", robert.id);
  await admin.from("contacts").update({ source_lead_id: patriciaLead.id }).eq("id", patricia.id);

  // ---------------------------------------------------------------
  // 3. Create conversations
  // ---------------------------------------------------------------

  const conversations = [
    {
      firm_id: LFL_FIRM_ID,
      lead_id: margaretLead.id,
      contact_id: margaret.id,
      status: "active" as const,
      phase: "initial_contact" as const,
      channel: "manual",
      message_count: 0,
    },
    {
      firm_id: LFL_FIRM_ID,
      lead_id: robertLead.id,
      contact_id: robert.id,
      status: "active" as const,
      phase: "qualification" as const,
      channel: "email",
      message_count: 3,
    },
    {
      firm_id: LFL_FIRM_ID,
      lead_id: patriciaLead.id,
      contact_id: patricia.id,
      status: "active" as const,
      phase: "negotiation" as const,
      channel: "manual",
      message_count: 5,
    },
  ];

  const { data: insertedConvos, error: convoErr } = await admin
    .from("conversations")
    .insert(conversations)
    .select("id");

  if (convoErr || !insertedConvos) {
    console.error("Failed to create conversations:", convoErr?.message);
    process.exit(1);
  }

  console.log(`3. Created ${insertedConvos.length} conversations`);

  // ---------------------------------------------------------------
  // 4. Add classification for Robert (qualified lead)
  // ---------------------------------------------------------------

  const { error: classErr } = await admin.from("classifications").insert({
    firm_id: LFL_FIRM_ID,
    lead_id: robertLead.id,
    matter_type: "estate_planning",
    confidence: 0.92,
    signals: {
      keywords: ["trust", "power of attorney", "estate"],
      referral_source: "bank",
    },
    model: "claude-haiku-4-5-20251001",
    is_current: true,
  });

  if (classErr) {
    console.error("Failed to create classification:", classErr.message);
  } else {
    console.log("4. Created classification for Robert Chen (92% estate_planning)");
  }

  // ---------------------------------------------------------------
  // 5. Create matter for Patricia (converted lead) at fee_quoted stage
  // ---------------------------------------------------------------

  const feeQuotedStageId = slugToId.get("fee_quoted");
  const newLeadStageId = slugToId.get("new_lead");
  const inConversationStageId = slugToId.get("in_conversation");

  if (!feeQuotedStageId || !newLeadStageId || !inConversationStageId) {
    console.error("Missing required pipeline stages");
    process.exit(1);
  }

  const { data: matter, error: matterErr } = await admin
    .from("matters")
    .insert({
      firm_id: LFL_FIRM_ID,
      contact_id: patricia.id,
      lead_id: patriciaLead.id,
      matter_type: "estate_planning",
      stage_id: feeQuotedStageId,
      status: "active",
      jurisdiction: "IA",
      assigned_to: ownerId,
      summary: "Full estate plan: will, revocable trust, POA, healthcare directive. 3 children as beneficiaries.",
    })
    .select("id")
    .single();

  if (matterErr || !matter) {
    console.error("Failed to create matter:", matterErr?.message);
    process.exit(1);
  }

  console.log(`5. Created matter for Patricia Williams (stage: fee_quoted)`);

  // Stage history entries
  const historyEntries = [
    {
      firm_id: LFL_FIRM_ID,
      matter_id: matter.id,
      from_stage_id: null,
      to_stage_id: newLeadStageId,
      actor_id: ownerId,
      reason: "Lead converted to matter",
    },
    {
      firm_id: LFL_FIRM_ID,
      matter_id: matter.id,
      from_stage_id: newLeadStageId,
      to_stage_id: inConversationStageId,
      actor_id: ownerId,
      reason: "Initial consultation complete",
    },
    {
      firm_id: LFL_FIRM_ID,
      matter_id: matter.id,
      from_stage_id: inConversationStageId,
      to_stage_id: feeQuotedStageId,
      actor_id: ownerId,
      reason: "Fee quote prepared",
    },
  ];

  await admin.from("matter_stage_history").insert(historyEntries);

  // ---------------------------------------------------------------
  // 6. Create approved fee quote for Patricia's matter
  // ---------------------------------------------------------------

  // Pick first 3 services for line items
  const lineItems = services.slice(0, 3).map((s) => ({
    service_id: s.id,
    service_name: s.name,
    quantity: 1,
    unit_price: s.standard_price,
    subtotal: s.standard_price,
  }));

  const subtotal = lineItems.reduce((sum, item) => sum + item.subtotal, 0);

  const { data: feeQuote, error: fqErr } = await admin
    .from("fee_quotes")
    .insert({
      firm_id: LFL_FIRM_ID,
      matter_id: matter.id,
      contact_id: patricia.id,
      line_items: lineItems,
      subtotal,
      bundle_discount: 0,
      engagement_tier_discount: 0,
      total_quoted_fee: subtotal,
      floor_total: Math.round(subtotal * 0.8),
      status: "approved",
      approved_by: ownerId,
      approved_at: new Date().toISOString(),
    })
    .select("id, total_quoted_fee")
    .single();

  if (fqErr || !feeQuote) {
    console.error("Failed to create fee quote:", fqErr?.message);
    process.exit(1);
  }

  console.log(`6. Created approved fee quote: $${feeQuote.total_quoted_fee}`);

  // ---------------------------------------------------------------
  // 7. Create classification for Patricia's lead too
  // ---------------------------------------------------------------

  await admin.from("classifications").insert({
    firm_id: LFL_FIRM_ID,
    lead_id: patriciaLead.id,
    matter_type: "estate_planning",
    confidence: 0.97,
    signals: {
      keywords: ["estate plan", "will", "trust", "children"],
      explicit_request: true,
    },
    model: "claude-haiku-4-5-20251001",
    is_current: true,
  });

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------

  console.log("\n--- Demo Data Summary ---");
  console.log("");
  console.log("LEADS:");
  console.log(`  Margaret Thompson  (new)        → ready for classification`);
  console.log(`  Robert Chen        (qualified)   → ready to convert to matter`);
  console.log(`  Patricia Williams  (converted)   → has matter + approved fee quote`);
  console.log("");
  console.log("PIPELINE:");
  console.log(`  Patricia Williams @ Fee Quoted → ready for "Generate Engagement Letter"`);
  console.log("");
  console.log("NEXT STEPS FOR DEMO:");
  console.log("  1. Login → Leads → see 3 leads");
  console.log("  2. Leads → 'New Lead' → create a 4th lead manually");
  console.log("  3. Conversations → click Robert Chen → 'Convert to Matter'");
  console.log("  4. Pipeline → click Patricia Williams → 'Generate Engagement Letter'");
  console.log("  5. Engagements → 'Submit for Approval'");
  console.log("  6. Approvals → approve engagement letter");
  console.log("  7. Engagements → 'Send for Signature' (dry run)");
  console.log("");
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
