"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";

/**
 * Get the current user's ID and firm ID. Throws if not authenticated or
 * user does not belong to a firm.
 */
async function getActorInfo(): Promise<{ userId: string; firmId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    throw new Error("User does not belong to a firm");
  }

  return { userId: user.id, firmId: membership.firm_id };
}

/**
 * Create a new lead from a manual entry (phone call, walk-in, referral).
 *
 * Creates lead + contact + conversation, fires classification event,
 * and returns IDs for navigation.
 */
export async function createLead(formData: FormData): Promise<{
  leadId: string;
  conversationId: string;
}> {
  const fullName = (formData.get("fullName") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const state = (formData.get("state") as string)?.trim() || null;
  const source = (formData.get("source") as string)?.trim() || "manual";
  const notes = (formData.get("notes") as string)?.trim() || null;

  if (!fullName) throw new Error("Name is required");
  if (!email && !phone) throw new Error("At least one of email or phone is required");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  // 1. Create contact
  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .insert({
      firm_id: firmId,
      full_name: fullName,
      email,
      phone,
      state,
      source_lead_id: null,
      dnc: false,
    })
    .select("id")
    .single();

  if (contactErr || !contact) {
    throw new Error(`Failed to create contact: ${contactErr?.message}`);
  }

  // 2. Create lead
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .insert({
      firm_id: firmId,
      source: source as "manual" | "referral",
      status: "new",
      channel: "manual",
      full_name: fullName,
      email,
      phone,
      contact_id: contact.id,
      payload: notes ? { notes } : null,
      priority: 5,
      assigned_to: userId,
    })
    .select("id")
    .single();

  if (leadErr || !lead) {
    throw new Error(`Failed to create lead: ${leadErr?.message}`);
  }

  // Update contact's source_lead_id
  await admin
    .from("contacts")
    .update({ source_lead_id: lead.id })
    .eq("id", contact.id);

  // 3. Create conversation
  const { data: conversation, error: convoErr } = await admin
    .from("conversations")
    .insert({
      firm_id: firmId,
      lead_id: lead.id,
      contact_id: contact.id,
      status: "active",
      phase: "initial_contact",
      channel: "manual",
      message_count: 0,
    })
    .select("id")
    .single();

  if (convoErr || !conversation) {
    throw new Error(`Failed to create conversation: ${convoErr?.message}`);
  }

  // 4. Fire classification event
  try {
    await inngest.send({
      name: "lead.created",
      data: { leadId: lead.id, firmId },
    });
  } catch {
    // Non-fatal — classification will happen on next poll
    console.error("Failed to send lead.created event to Inngest");
  }

  // 5. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "lead.created_manually",
    p_entity_type: "lead",
    p_entity_id: lead.id,
    p_before: null,
    p_after: {
      full_name: fullName,
      email,
      phone,
      state,
      source,
      contact_id: contact.id,
      conversation_id: conversation.id,
    },
    p_metadata: { notes },
  });

  revalidatePath("/leads");
  revalidatePath("/conversations");
  revalidatePath("/dashboard");

  return { leadId: lead.id, conversationId: conversation.id };
}
