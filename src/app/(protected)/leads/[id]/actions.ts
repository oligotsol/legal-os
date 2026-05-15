"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function getActorInfo(): Promise<{ userId: string; firmId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) throw new Error("User does not belong to a firm");

  return { userId: user.id, firmId: membership.firm_id };
}

export interface LeadNoteEntry {
  body: string;
  added_at: string;
  added_by: string;
  added_by_name?: string | null;
  source?: string;
}

/**
 * Append a free-text internal note to `lead.payload.notes[]`.
 * Used by:
 *   - the lead detail page's Notes section
 *   - the power dialer's quick-note input (during/after a call)
 *
 * Notes are NOT outbound client messages — they're internal. No approval queue.
 */
export async function addLeadNote(
  leadId: string,
  body: string,
  source: "lead_detail" | "power_dialer" = "lead_detail",
): Promise<{ ok: true; addedAt: string }> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Note cannot be empty");
  if (trimmed.length > 4000) throw new Error("Note too long (max 4000 chars)");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(payload.notes)
    ? (payload.notes as LeadNoteEntry[])
    : [];

  const addedAt = new Date().toISOString();
  const entry: LeadNoteEntry = {
    body: trimmed,
    added_at: addedAt,
    added_by: userId,
    source,
  };

  const { error: updateErr } = await admin
    .from("leads")
    .update({ payload: { ...payload, notes: [...existing, entry] } })
    .eq("id", leadId)
    .eq("firm_id", firmId);
  if (updateErr) throw new Error(`Failed to save note: ${updateErr.message}`);

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "lead.note_added",
    p_entity_type: "lead",
    p_entity_id: leadId,
    p_before: null,
    p_after: { char_count: trimmed.length, source },
    p_metadata: { source },
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/power-dialer");

  return { ok: true, addedAt };
}
