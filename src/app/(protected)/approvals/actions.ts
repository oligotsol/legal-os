"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchMessage } from "@/lib/dispatch/outbound";
import { redraftMessage } from "@/lib/ai/redraft-message";
import {
  buildContextSnapshot,
  recordHumanEdit,
  recordRedraft,
} from "@/lib/ai/draft-history";

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

/**
 * AI redraft — rewrite an existing message draft given attorney instructions.
 *
 * Does NOT advance the approval queue — the redrafted message stays
 * `pending_approval` so the attorney reviews the AI's new version before
 * dispatching. Logs the AI call to `ai_jobs` per CLAUDE.md rule #5.
 *
 * Returns the new draft text so the client can update its editable textarea
 * without a full page reload.
 */
export async function redraftMessageAction(formData: FormData): Promise<{
  content: string;
}> {
  const queueItemId = formData.get("queueItemId") as string;
  const instructions = ((formData.get("instructions") as string) ?? "").trim();
  if (!queueItemId) throw new Error("Missing queue item ID");
  if (!instructions) throw new Error("Instructions are required");

  const { firmId } = await validateApproverRole();
  const admin = createAdminClient();

  // Load the queue item and the underlying message.
  const { data: queueItem } = await admin
    .from("approval_queue")
    .select("*")
    .eq("id", queueItemId)
    .eq("firm_id", firmId)
    .eq("status", "pending")
    .maybeSingle();
  if (!queueItem) throw new Error("Queue item not found or already processed");
  if (queueItem.entity_type !== "message") {
    throw new Error("Redraft only supports message approvals");
  }

  const { data: message } = await admin
    .from("messages")
    .select("id, content, channel, conversation_id")
    .eq("id", queueItem.entity_id)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!message) throw new Error("Message not found");

  // Snapshot the original draft + context BEFORE the redraft mutates
  // messages.content. This is the training-data backbone.
  const preRedraftContent = message.content ?? "";
  let leadIdForHistory: string | null = null;
  if (message.conversation_id) {
    const { data: convoRow } = await admin
      .from("conversations")
      .select("lead_id")
      .eq("id", message.conversation_id)
      .maybeSingle();
    leadIdForHistory = (convoRow as { lead_id?: string | null } | null)?.lead_id ?? null;
  }
  const contextSnapshot = await buildContextSnapshot(admin, {
    firmId,
    leadId: leadIdForHistory,
    conversationId: message.conversation_id ?? null,
  });

  // Pull firm config for tone / banned phrases / sign-off so the redraft
  // stays consistent with the original draft's voice.
  const { data: configs } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", ["conversation_config", "negotiation_config"]);
  const cfgMap = Object.fromEntries(
    (configs ?? []).map((c) => [c.key, c.value as Record<string, unknown>]),
  );
  const conv = cfgMap.conversation_config ?? {};
  const neg = cfgMap.negotiation_config ?? {};

  const channel =
    message.channel === "sms" || message.channel === "email"
      ? (message.channel as "sms" | "email")
      : null;

  const result = await redraftMessage({
    currentDraft: message.content ?? "",
    instructions,
    channel,
    firmName: (neg.firm_name as string) ?? undefined,
    attorneyName: (neg.attorney_name as string) ?? undefined,
    tone: (neg.tone as string) ?? undefined,
    bannedPhrases: (conv.banned_phrases as string[]) ?? undefined,
    signOff:
      channel === "sms"
        ? ((conv.sms_config as Record<string, unknown> | undefined)?.sign_off as
            | string
            | undefined) ?? undefined
        : ((conv.email_config as Record<string, unknown> | undefined)?.sign_off as
            | string
            | undefined) ?? undefined,
    model: (conv.model as string) ?? undefined,
    smsCharLimit: (conv.sms_char_limit as number) ?? undefined,
  });

  // Replace the message body and re-tag metadata so we know it was redrafted.
  await admin
    .from("messages")
    .update({
      content: result.reply,
      metadata: {
        ...((message as { metadata?: Record<string, unknown> }).metadata ?? {}),
        last_redraft_instructions: instructions,
        last_redraft_at: new Date().toISOString(),
      },
    })
    .eq("id", message.id)
    .eq("firm_id", firmId);

  // Log the AI call so the cost ledger stays accurate. Capture the row id
  // so we can link the redraft history entry to the exact ai_jobs row.
  const { data: aiJobRow } = await admin
    .from("ai_jobs")
    .insert({
      firm_id: firmId,
      model: result.model,
      purpose: "converse",
      entity_type: "message",
      entity_id: message.id,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: result.costCents,
      latency_ms: result.latencyMs,
      status: "completed",
      request_metadata: { kind: "redraft", instructions },
      response_metadata: null,
      privileged: false,
    })
    .select("id")
    .single();

  // Training-data capture: persist the pre-redraft draft + the new content
  // + the instructions Garrison gave, alongside the lead/conversation
  // context the AI saw. Best-effort — never blocks the user-facing flow.
  await recordRedraft({
    admin,
    firmId,
    messageId: message.id,
    oldContent: preRedraftContent,
    newContent: result.reply,
    instructions,
    conversationId: message.conversation_id ?? null,
    leadId: leadIdForHistory,
    approvalQueueId: queueItem.id,
    channel: channel ?? null,
    aiModel: result.model,
    aiJobId: aiJobRow?.id ?? null,
    contextSnapshot,
  });

  // Refresh views that show the draft.
  revalidatePath("/approvals");
  revalidatePath(`/leads`);

  return { content: result.reply };
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

  // Training-data capture: if the entity is a message, record the human's
  // edit alongside the prior content + context. Mirror of the redraft
  // capture; together they let us reconstruct the full draft → edit → send
  // lineage for any message.
  if (queueItem.entity_type === "message") {
    const preEditContent =
      (originalContent as Record<string, unknown> | null)?.content;
    const channel =
      (originalContent as Record<string, unknown> | null)?.channel;
    let leadIdForHistory: string | null = null;
    let conversationId: string | null = null;
    const convoId = (originalContent as Record<string, unknown> | null)?.conversation_id;
    if (typeof convoId === "string") {
      conversationId = convoId;
      const { data: convoRow } = await admin
        .from("conversations")
        .select("lead_id")
        .eq("id", convoId)
        .maybeSingle();
      leadIdForHistory =
        (convoRow as { lead_id?: string | null } | null)?.lead_id ?? null;
    }
    const contextSnapshot = await buildContextSnapshot(admin, {
      firmId,
      leadId: leadIdForHistory,
      conversationId,
    });
    await recordHumanEdit({
      admin,
      firmId,
      messageId: queueItem.entity_id,
      oldContent: typeof preEditContent === "string" ? preEditContent : "",
      newContent: editedContent.trim(),
      actorId: userId,
      conversationId,
      leadId: leadIdForHistory,
      approvalQueueId: queueItemId,
      channel: typeof channel === "string" ? channel : null,
      contextSnapshot,
    });
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

export interface MessageContextThread {
  /** The inbound message that triggered the AI draft (most recent inbound on
   *  the conversation prior to or at draft-creation time). Null if none. */
  latestInbound: {
    id: string;
    content: string;
    channel: string | null;
    createdAt: string;
  } | null;
  /** Last few messages on the conversation (most recent first), excluding
   *  the draft itself. Used to render a small thread snippet in the review
   *  sheet so the reviewer can see prior context without leaving the page. */
  recent: Array<{
    id: string;
    direction: "inbound" | "outbound";
    senderType: string | null;
    content: string;
    channel: string | null;
    status: string | null;
    createdAt: string;
  }>;
  /** Total messages on the conversation (including the draft) — helps the
   *  reviewer judge whether "no prior context" is real. */
  totalMessages: number;
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
  let entity: Record<string, unknown> | null = null;
  let messageContext: MessageContextThread | null = null;

  if (entityMap) {
    const { data } = await admin
      .from(entityMap.table)
      .select("*")
      .eq("id", queueItem.entity_id)
      .eq("firm_id", firmId)
      .single();

    entity = data as Record<string, unknown> | null;
  }

  // For message approvals, pull the surrounding conversation so the
  // reviewer can see what the prospect said before they decide what to
  // send. Without this they only see the AI's draft + its reasoning,
  // which is exactly the case the "no prior context" escalation was
  // flagging — and they had no way to verify it.
  if (queueItem.entity_type === "message" && entity) {
    const conversationId = entity.conversation_id as string | undefined;
    const draftId = entity.id as string | undefined;
    if (conversationId) {
      const { data: msgs, count } = await admin
        .from("messages")
        .select("id, direction, sender_type, content, channel, status, created_at", {
          count: "exact",
        })
        .eq("conversation_id", conversationId)
        .eq("firm_id", firmId)
        .order("created_at", { ascending: false })
        .limit(8);

      const rows = (msgs ?? []) as Array<{
        id: string;
        direction: string | null;
        sender_type: string | null;
        content: string | null;
        channel: string | null;
        status: string | null;
        created_at: string;
      }>;
      const recent = rows
        .filter((m) => m.id !== draftId && (m.content ?? "").length > 0)
        .map((m) => ({
          id: m.id,
          direction: (m.direction === "outbound" ? "outbound" : "inbound") as
            | "inbound"
            | "outbound",
          senderType: m.sender_type,
          content: m.content ?? "",
          channel: m.channel,
          status: m.status,
          createdAt: m.created_at,
        }));
      const latestInbound = recent.find((m) => m.direction === "inbound") ?? null;
      messageContext = {
        latestInbound: latestInbound
          ? {
              id: latestInbound.id,
              content: latestInbound.content,
              channel: latestInbound.channel,
              createdAt: latestInbound.createdAt,
            }
          : null,
        recent,
        totalMessages: count ?? rows.length,
      };
    }
  }

  return { queueItem, entity, messageContext };
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
