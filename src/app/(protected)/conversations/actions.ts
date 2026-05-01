"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { convertLeadToMatter } from "@/lib/pipeline/convert-lead";
import { getApprovalMode } from "@/lib/approval-mode";

/**
 * Get the current user's ID and firm ID.
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
 * Convert a lead to a matter.
 *
 * Extracts leadId, contactId, matterType, jurisdiction, and summary from FormData.
 * Returns the new matter ID.
 */
export async function convertLead(formData: FormData): Promise<string> {
  const leadId = formData.get("leadId") as string;
  const contactId = formData.get("contactId") as string;
  const matterType = (formData.get("matterType") as string)?.trim() || null;
  const jurisdiction = (formData.get("jurisdiction") as string)?.trim() || null;
  const summary = (formData.get("summary") as string)?.trim() || null;

  if (!leadId) throw new Error("Missing lead ID");
  if (!contactId) throw new Error("Missing contact ID");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  const result = await convertLeadToMatter(admin, {
    firmId,
    leadId,
    contactId,
    matterType,
    jurisdiction,
    summary,
    actorId: userId,
  });

  revalidatePath("/pipeline");
  revalidatePath("/conversations");
  revalidatePath("/leads");

  return result.matterId;
}

/**
 * Send an outbound message from the conversation detail sheet.
 *
 * Creates a message with pending_approval status and an approval queue entry
 * (unless the firm is configured for auto_approve on messages).
 */
export async function sendMessage(formData: FormData): Promise<string> {
  const conversationId = formData.get("conversationId") as string;
  const content = (formData.get("content") as string)?.trim();
  const channel = formData.get("channel") as string;
  const subject = (formData.get("subject") as string)?.trim() || null;

  if (!conversationId) throw new Error("Missing conversation ID");
  if (!content) throw new Error("Message content is required");
  if (channel !== "sms" && channel !== "email") {
    throw new Error("Channel must be sms or email");
  }

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  // Fetch conversation to verify ownership and get contact info
  const { data: conversation, error: convErr } = await admin
    .from("conversations")
    .select("id, firm_id, contact_id, contacts:contact_id(full_name)")
    .eq("id", conversationId)
    .eq("firm_id", firmId)
    .single();

  if (convErr || !conversation) {
    throw new Error("Conversation not found");
  }

  const approvalMode = await getApprovalMode(firmId, "message");
  const status = approvalMode === "auto_approve" ? "approved" : "pending_approval";

  // Insert message
  const { data: message, error: msgErr } = await admin
    .from("messages")
    .insert({
      firm_id: firmId,
      conversation_id: conversationId,
      direction: "outbound",
      channel,
      content,
      sender_type: "attorney",
      sender_id: userId,
      ai_generated: false,
      status,
      metadata: subject ? { subject } : null,
    })
    .select("id")
    .single();

  if (msgErr || !message) {
    throw new Error(`Failed to create message: ${msgErr?.message}`);
  }

  // Update conversation timestamp
  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("firm_id", firmId);

  const contactRaw = conversation.contacts as unknown;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    full_name: string;
  } | null;
  const contactName = contact?.full_name ?? "Unknown";

  if (approvalMode === "always_review") {
    // Create approval queue entry
    const { error: queueErr } = await admin.from("approval_queue").insert({
      firm_id: firmId,
      entity_type: "message",
      entity_id: message.id,
      action_type: "message",
      priority: 3,
      status: "pending",
      metadata: {
        contact_name: contactName,
        channel,
        summary: content.length > 120 ? content.slice(0, 120) + "…" : content,
      },
    });

    if (queueErr) {
      throw new Error(`Failed to create approval entry: ${queueErr.message}`);
    }
  } else {
    // Auto-approve: mark as approved (dispatch happens via approval flow)
    await admin
      .from("messages")
      .update({ status: "approved" })
      .eq("id", message.id)
      .eq("firm_id", firmId);
  }

  // Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "message.composed",
    p_entity_type: "message",
    p_entity_id: message.id,
    p_before: null,
    p_after: { channel, status, content_length: content.length },
    p_metadata: null,
  });

  revalidatePath("/conversations");
  revalidatePath("/approvals");

  return message.id;
}
