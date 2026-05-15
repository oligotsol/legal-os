"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { convertLeadToMatter } from "@/lib/pipeline/convert-lead";
import { dispatchMessage } from "@/lib/dispatch/outbound";

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

export interface SendMessageResult {
  messageId: string;
  status: "sent" | "failed";
  sentAt: string | null;
  externalId: string | null;
  provider: string | null;
  dryRun: boolean;
  error?: string;
}

/**
 * Send an outbound message that the ATTORNEY typed in the composer.
 *
 * Per CLAUDE.md §3 the three hard approval gates are fee_quote /
 * engagement_letter / invoice — plain outbound messages aren't one of them.
 * When the attorney composes and clicks Send, dispatch immediately. AI
 * drafts (from `generateDraftReply`) still go through the approval queue —
 * that path is unchanged.
 *
 * Returns the dispatch result so the UI can render a "Sent ✓ at HH:MM"
 * confirmation (or surface the failure reason) instead of the old
 * "queued for approval" message.
 */
export async function sendMessage(formData: FormData): Promise<SendMessageResult> {
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

  // Pull conversation + contact in one shot — we need the recipient address
  // before we can dispatch.
  const { data: conversation, error: convErr } = await admin
    .from("conversations")
    .select(
      "id, firm_id, contact_id, contacts:contact_id(full_name, phone, email)",
    )
    .eq("id", conversationId)
    .eq("firm_id", firmId)
    .single();

  if (convErr || !conversation) {
    throw new Error("Conversation not found");
  }

  const contactRaw = conversation.contacts as unknown;
  const contact = (
    Array.isArray(contactRaw) ? contactRaw[0] : contactRaw
  ) as {
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;

  const recipient = channel === "sms" ? contact?.phone : contact?.email;
  if (!recipient) {
    throw new Error(
      `Contact has no ${channel === "sms" ? "phone number" : "email address"} on file.`,
    );
  }

  // Resolve the firm's "from" identifier for this channel. Without it the
  // adapter has no idea which Dialpad / Gmail account to send from.
  const fromKey =
    channel === "sms" ? "dialpad_from_number" : "gmail_from_address";
  const { data: fromCfg } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", fromKey)
    .maybeSingle();
  const from =
    ((fromCfg?.value as Record<string, unknown> | null)?.value as
      | string
      | undefined) ?? "";
  if (!from) {
    throw new Error(
      `No ${channel === "sms" ? "phone number" : "email address"} configured for this firm to send from. ` +
        `Add a firm_config row for "${fromKey}".`,
    );
  }

  // Insert the message row in a pre-dispatch state ("approved" — already
  // approved by the attorney via the act of clicking Send). We need a row
  // ID before dispatch so we can store the external_id and audit-trail
  // ties back to it correctly.
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
      status: "approved",
      metadata: subject ? { subject } : null,
    })
    .select("id")
    .single();

  if (msgErr || !message) {
    throw new Error(`Failed to create message: ${msgErr?.message}`);
  }

  // Dispatch — this is the actual network call to Dialpad / Gmail.
  let dispatchResult;
  try {
    dispatchResult = await dispatchMessage(firmId, {
      channel,
      to: recipient,
      from,
      body: content,
      subject:
        channel === "email"
          ? subject ?? "Message from your attorney"
          : undefined,
      externalRef: message.id,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", message.id);
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: userId,
      p_action: "message.dispatch_failed",
      p_entity_type: "message",
      p_entity_id: message.id,
      p_before: { status: "approved" },
      p_after: {
        status: "failed",
        error: errMsg.slice(0, 1000),
        sender: "attorney",
        channel,
      },
      p_metadata: null,
    });
    revalidatePath("/conversations");
    revalidatePath("/leads", "layout");
    return {
      messageId: message.id,
      status: "failed",
      sentAt: null,
      externalId: null,
      provider: null,
      dryRun: false,
      error: errMsg,
    };
  }

  const sentAt = new Date().toISOString();
  const externalId = dispatchResult.result.messageId ?? null;
  const provider = dispatchResult.provider;

  await admin
    .from("messages")
    .update({
      status: "sent",
      external_id: externalId,
      sent_at: sentAt,
    })
    .eq("id", message.id);

  await admin
    .from("conversations")
    .update({ last_message_at: sentAt })
    .eq("id", conversationId)
    .eq("firm_id", firmId);

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "message.dispatched",
    p_entity_type: "message",
    p_entity_id: message.id,
    p_before: { status: "approved" },
    p_after: {
      status: "sent",
      channel,
      provider,
      external_id: externalId,
      dry_run: dispatchResult.result.dryRun,
      sender: "attorney",
    },
    p_metadata: null,
  });

  revalidatePath("/conversations");
  revalidatePath("/leads", "layout");

  return {
    messageId: message.id,
    status: "sent",
    sentAt,
    externalId,
    provider,
    dryRun: dispatchResult.result.dryRun,
  };
}
