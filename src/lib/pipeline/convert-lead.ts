/**
 * Convert a qualified lead into a matter.
 *
 * Pure function: takes admin client + input, performs all DB writes.
 * Does NOT validate auth — caller is responsible for that.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConvertLeadInput {
  firmId: string;
  leadId: string;
  contactId: string;
  matterType: string | null;
  jurisdiction: string | null;
  summary: string | null;
  actorId: string;
}

export interface ConvertLeadResult {
  matterId: string;
  stageId: string;
}

export async function convertLeadToMatter(
  admin: SupabaseClient,
  input: ConvertLeadInput,
): Promise<ConvertLeadResult> {
  const { firmId, leadId, contactId, matterType, jurisdiction, summary, actorId } = input;

  // 1. Fetch initial pipeline stage (new_lead)
  const { data: initialStage, error: stageErr } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("firm_id", firmId)
    .eq("slug", "new_lead")
    .single();

  if (stageErr || !initialStage) {
    throw new Error("Pipeline stage 'new_lead' not found");
  }

  // 2. Fetch current classification for the lead (if any)
  let resolvedMatterType = matterType;
  if (!resolvedMatterType) {
    const { data: classification } = await admin
      .from("classifications")
      .select("matter_type")
      .eq("lead_id", leadId)
      .eq("is_current", true)
      .maybeSingle();

    resolvedMatterType = classification?.matter_type ?? null;
  }

  // 3. Verify lead is not already converted
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .single();

  if (leadErr || !lead) {
    throw new Error("Lead not found");
  }

  if (lead.status === "converted") {
    throw new Error("Lead has already been converted to a matter");
  }

  // 4. Insert matter
  const { data: matter, error: matterErr } = await admin
    .from("matters")
    .insert({
      firm_id: firmId,
      contact_id: contactId,
      lead_id: leadId,
      matter_type: resolvedMatterType,
      stage_id: initialStage.id,
      status: "active",
      jurisdiction,
      assigned_to: actorId,
      summary,
    })
    .select("id")
    .single();

  if (matterErr || !matter) {
    throw new Error(`Failed to create matter: ${matterErr?.message}`);
  }

  // 5. Insert matter_stage_history entry
  const { error: historyErr } = await admin
    .from("matter_stage_history")
    .insert({
      firm_id: firmId,
      matter_id: matter.id,
      from_stage_id: null,
      to_stage_id: initialStage.id,
      actor_id: actorId,
      reason: "Lead converted to matter",
    });

  if (historyErr) {
    throw new Error(`Failed to create stage history: ${historyErr.message}`);
  }

  // 6. Update lead status to "converted"
  const { error: updateErr } = await admin
    .from("leads")
    .update({ status: "converted" })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  if (updateErr) {
    throw new Error(`Failed to update lead status: ${updateErr.message}`);
  }

  // 7. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: actorId,
    p_action: "lead.converted_to_matter",
    p_entity_type: "lead",
    p_entity_id: leadId,
    p_before: { status: lead.status },
    p_after: {
      status: "converted",
      matter_id: matter.id,
      matter_type: resolvedMatterType,
      stage_id: initialStage.id,
    },
    p_metadata: { jurisdiction, summary },
  });

  return {
    matterId: matter.id,
    stageId: initialStage.id,
  };
}
