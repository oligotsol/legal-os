"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchMessage } from "@/lib/dispatch/outbound";

async function validateApproverRole(): Promise<{
  userId: string;
  firmId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "attorney"])
    .single();

  if (!membership) {
    throw new Error("Insufficient permissions: owner or attorney role required");
  }

  return { userId: user.id, firmId: membership.firm_id };
}

// Maps entity_type to the table and status column for updating after approval
const ENTITY_STATUS_MAP: Record<
  string,
  { table: string; statusField: string }
> = {
  fee_quote: { table: "fee_quotes", statusField: "status" },
  engagement_letter: { table: "engagement_letters", statusField: "status" },
  invoice: { table: "invoices", statusField: "status" },
  message: { table: "messages", statusField: "status" },
};

/**
 * Snapshot the full underlying entity at the moment of approval/rejection
 * so the immutable approvals row preserves what was decided on. Without
 * this, "what did Garrison approve?" becomes a join through mutable rows
 * (messages.content can be edited after the fact) and is not reliably
 * reconstructable. This is the training-data backbone — capture once,
 * forever queryable.
 */
async function snapshotEntity(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  const entityMap = ENTITY_STATUS_MAP[entityType];
  if (!entityMap) return null;
  const { data } = await admin
    .from(entityMap.table)
    .select("*")
    .eq("id", entityId)
    .eq("firm_id", firmId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

export async function approveItem(formData: FormData) {
  const queueItemId = formData.get("queueItemId") as string;
  if (!queueItemId) throw new Error("Missing queue item ID");

  const { userId, firmId } = await validateApproverRole();
  const admin = createAdminClient();

  // Fetch the queue item and verify it's pending
  const { data: queueItem, error: fetchErr } = await admin
    .from("approval_queue")
    .select("*")
    .eq("id", queueItemId)
    .eq("firm_id", firmId)
    .eq("status", "pending")
    .single();

  if (fetchErr || !queueItem) {
    throw new Error("Queue item not found or already processed");
  }

  // Snapshot entity state BEFORE the approval flips its status.
  const snapshot = await snapshotEntity(
    admin,
    firmId,
    queueItem.entity_type,
    queueItem.entity_id,
  );

  // Insert immutable approval record. For plain "approved" (no edits),
  // edited_content equals original_content so a unified "what was sent"
  // query works regardless of decision type.
  const { error: approvalErr } = await admin.from("approvals").insert({
    firm_id: firmId,
    queue_item_id: queueItemId,
    decision: "approved",
    decided_by: userId,
    original_content: snapshot,
    edited_content: snapshot,
  });

  if (approvalErr) throw new Error(`Approval insert failed: ${approvalErr.message}`);

  // Update queue status
  const { error: queueErr } = await admin
    .from("approval_queue")
    .update({ status: "approved" })
    .eq("id", queueItemId);

  if (queueErr) throw new Error(`Queue update failed: ${queueErr.message}`);

  // Update entity status
  const entityMap = ENTITY_STATUS_MAP[queueItem.entity_type];
  if (entityMap) {
    await admin
      .from(entityMap.table)
      .update({
        [entityMap.statusField]: "approved",
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", queueItem.entity_id)
      .eq("firm_id", firmId);
  }

  // Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "approval.approved",
    p_entity_type: queueItem.entity_type,
    p_entity_id: queueItem.entity_id,
    p_before: { status: "pending" },
    p_after: { status: "approved", decided_by: userId },
    p_metadata: { queue_item_id: queueItemId },
  });

  // Dispatch outbound message if this is a message approval
  if (queueItem.entity_type === "message") {
    await dispatchApprovedMessage(admin, firmId, userId, queueItem.entity_id);
  }

  revalidatePath("/approvals");
}

export async function rejectItem(formData: FormData) {
  const queueItemId = formData.get("queueItemId") as string;
  const reason = formData.get("reason") as string;
  if (!queueItemId) throw new Error("Missing queue item ID");
  if (!reason?.trim()) throw new Error("Rejection reason is required");

  const { userId, firmId } = await validateApproverRole();
  const admin = createAdminClient();

  const { data: queueItem, error: fetchErr } = await admin
    .from("approval_queue")
    .select("*")
    .eq("id", queueItemId)
    .eq("firm_id", firmId)
    .eq("status", "pending")
    .single();

  if (fetchErr || !queueItem) {
    throw new Error("Queue item not found or already processed");
  }

  // Snapshot what was rejected — useful for training ("Garrison rejected this kind of draft").
  const snapshot = await snapshotEntity(
    admin,
    firmId,
    queueItem.entity_type,
    queueItem.entity_id,
  );

  const { error: approvalErr } = await admin.from("approvals").insert({
    firm_id: firmId,
    queue_item_id: queueItemId,
    decision: "rejected",
    decided_by: userId,
    reason: reason.trim(),
    original_content: snapshot,
  });

  if (approvalErr) throw new Error(`Approval insert failed: ${approvalErr.message}`);

  const { error: queueErr } = await admin
    .from("approval_queue")
    .update({ status: "rejected" })
    .eq("id", queueItemId);

  if (queueErr) throw new Error(`Queue update failed: ${queueErr.message}`);

  const entityMap = ENTITY_STATUS_MAP[queueItem.entity_type];
  if (entityMap) {
    await admin
      .from(entityMap.table)
      .update({ [entityMap.statusField]: "rejected" })
      .eq("id", queueItem.entity_id)
      .eq("firm_id", firmId);
  }

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "approval.rejected",
    p_entity_type: queueItem.entity_type,
    p_entity_id: queueItem.entity_id,
    p_before: { status: "pending" },
    p_after: { status: "rejected", decided_by: userId, reason: reason.trim() },
    p_metadata: { queue_item_id: queueItemId },
  });

  revalidatePath("/approvals");
}

export async function editAndApproveItem(formData: FormData) {
  const queueItemId = formData.get("queueItemId") as string;
  const editedContent = formData.get("editedContent") as string;
  if (!queueItemId) throw new Error("Missing queue item ID");
  if (!editedContent?.trim()) throw new Error("Edited content is required");

  const { userId, firmId } = await validateApproverRole();
  const admin = createAdminClient();

  const { data: queueItem, error: fetchErr } = await admin
    .from("approval_queue")
    .select("*")
    .eq("id", queueItemId)
    .eq("firm_id", firmId)
    .eq("status", "pending")
    .single();

  if (fetchErr || !queueItem) {
    throw new Error("Queue item not found or already processed");
  }

  // Snapshot the FULL entity before edit, not the 200-char metadata preview.
  const originalContent =
    (await snapshotEntity(
      admin,
      firmId,
      queueItem.entity_type,
      queueItem.entity_id,
    )) ?? (queueItem.metadata ?? {});

  const { error: approvalErr } = await admin.from("approvals").insert({
    firm_id: firmId,
    queue_item_id: queueItemId,
    decision: "edited_and_approved",
    decided_by: userId,
    original_content: originalContent,
    edited_content: { content: editedContent.trim() },
  });

  if (approvalErr) throw new Error(`Approval insert failed: ${approvalErr.message}`);

  const { error: queueErr } = await admin
    .from("approval_queue")
    .update({ status: "approved" })
    .eq("id", queueItemId);

  if (queueErr) throw new Error(`Queue update failed: ${queueErr.message}`);

  // Update entity with edited content
  const entityMap = ENTITY_STATUS_MAP[queueItem.entity_type];
  if (entityMap) {
    const updateData: Record<string, unknown> = {
      [entityMap.statusField]: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    };
    // For messages, update the content field
    if (queueItem.entity_type === "message") {
      updateData.content = editedContent.trim();
    }
    await admin
      .from(entityMap.table)
      .update(updateData)
      .eq("id", queueItem.entity_id)
      .eq("firm_id", firmId);
  }

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "approval.edited_and_approved",
    p_entity_type: queueItem.entity_type,
    p_entity_id: queueItem.entity_id,
    p_before: { status: "pending", content: originalContent },
    p_after: {
      status: "approved",
      decided_by: userId,
      edited_content: editedContent.trim(),
    },
    p_metadata: { queue_item_id: queueItemId },
  });

  // Dispatch outbound message if this is a message approval
  if (queueItem.entity_type === "message") {
    await dispatchApprovedMessage(admin, firmId, userId, queueItem.entity_id);
  }

  revalidatePath("/approvals");
}

export async function fetchItemDetail(queueItemId: string) {
  const { firmId } = await validateApproverRole();
  const admin = createAdminClient();

  const { data: queueItem, error: queueErr } = await admin
    .from("approval_queue")
    .select("*")
    .eq("id", queueItemId)
    .eq("firm_id", firmId)
    .single();

  if (queueErr || !queueItem) {
    throw new Error("Queue item not found");
  }

  // Fetch the underlying entity
  const entityMap = ENTITY_STATUS_MAP[queueItem.entity_type];
  let entity = null;

  if (entityMap) {
    const { data } = await admin
      .from(entityMap.table)
      .select("*")
      .eq("id", queueItem.entity_id)
      .eq("firm_id", firmId)
      .single();

    entity = data;
  }

  return { queueItem, entity };
}

// ---------------------------------------------------------------------------
// Dispatch helper — sends approved messages via the correct channel
// ---------------------------------------------------------------------------

async function dispatchApprovedMessage(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  actorId: string,
  messageId: string,
) {
  // Fetch the message
  const { data: message, error: msgErr } = await admin
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .eq("firm_id", firmId)
    .single();

  if (msgErr || !message) {
    console.error("Failed to fetch message for dispatch:", msgErr);
    return;
  }

  // Fetch the conversation to determine channel + contact info
  const { data: conversation, error: convoErr } = await admin
    .from("conversations")
    .select("*, contacts:contact_id(*)")
    .eq("id", message.conversation_id)
    .eq("firm_id", firmId)
    .single();

  if (convoErr || !conversation) {
    console.error("Failed to fetch conversation for dispatch:", convoErr);
    return;
  }

  const channel = message.channel ?? conversation.channel;
  if (!channel) {
    console.error("No channel found on message or conversation — skipping dispatch");
    return;
  }

  const contact = conversation.contacts as Record<string, unknown> | null;
  if (!contact) {
    console.error("No contact found for conversation — skipping dispatch");
    return;
  }

  // Build dispatch input based on channel
  const to = channel === "sms" ? (contact.phone as string) : (contact.email as string);
  if (!to) {
    console.error(`Contact missing ${channel === "sms" ? "phone" : "email"} — skipping dispatch`);
    return;
  }

  // Determine "from" address — use firm config or fallback
  const { data: firmConfig } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", channel === "sms" ? "dialpad_from_number" : "gmail_from_address")
    .maybeSingle();

  const from = (firmConfig?.value as Record<string, unknown>)?.value as string
    ?? (channel === "sms" ? "" : "");

  if (!from) {
    console.error(`No "from" ${channel} address configured for firm — skipping dispatch`);
    return;
  }

  try {
    const result = await dispatchMessage(firmId, {
      channel,
      to,
      from,
      body: message.content ?? "",
      subject: channel === "email" ? (message.metadata as Record<string, unknown>)?.subject as string ?? "Message from your attorney" : undefined,
      externalRef: message.id,
    });

    // Update message to "sent" with external ID
    const externalId = result.result.messageId;

    await admin
      .from("messages")
      .update({
        status: "sent",
        external_id: externalId ?? null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("firm_id", firmId);

    // Audit log the send
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: actorId,
      p_action: "message.dispatched",
      p_entity_type: "message",
      p_entity_id: messageId,
      p_before: { status: "approved" },
      p_after: {
        status: "sent",
        channel,
        provider: result.provider,
        external_id: externalId,
        dry_run: result.result.dryRun,
      },
      p_metadata: null,
    });
  } catch (err) {
    console.error("Dispatch failed:", err);

    // Mark message as failed
    await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", messageId)
      .eq("firm_id", firmId);

    // Audit log the failure
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: actorId,
      p_action: "message.dispatch_failed",
      p_entity_type: "message",
      p_entity_id: messageId,
      p_before: { status: "approved" },
      p_after: { status: "failed", error: err instanceof Error ? err.message : String(err) },
      p_metadata: null,
    });
  }
}
