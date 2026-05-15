/**
 * AI draft history capture.
 *
 * Every AI-authored or human-edited revision of a message draft lands in
 * `ai_draft_history` (append-only). The point is to mine this later to
 * improve prompts and to build few-shot / fine-tune datasets — without it,
 * the redraft flow destroys "what the AI said first," because messages.content
 * is mutated in place.
 *
 * Usage:
 *   1. After the AI initially drafts a message:
 *        await recordAiInitialDraft({ admin, firmId, messageId, content, ... })
 *   2. Inside redraftMessageAction, BEFORE you mutate messages.content:
 *        await recordRedraft({ admin, firmId, messageId, oldContent, newContent,
 *                              instructions, ... })
 *      (Internally this inserts two rows when oldContent has no prior
 *      history: a synthetic 'ai_initial' from the existing draft, then the
 *      'ai_redraft' for the new content. That way no signal is ever lost.)
 *   3. Inside editAndApproveItem (human edited at approval time):
 *        await recordHumanEdit({ admin, firmId, messageId, content, actorId })
 *
 * All calls are best-effort — if the insert fails we log and keep going,
 * because training-data capture should never block a customer-facing flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DraftSource =
  | "ai_initial"
  | "ai_redraft"
  | "human_edit"
  | "human_send";

export interface DraftHistoryRow {
  firmId: string;
  source: DraftSource;
  content: string;
  messageId?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  approvalQueueId?: string | null;
  aiJobId?: string | null;
  aiModel?: string | null;
  actorId?: string | null;
  redraftInstructions?: string | null;
  channel?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
}

async function nextRevisionNumber(
  admin: SupabaseClient,
  messageId: string | null | undefined,
): Promise<number> {
  if (!messageId) return 1;
  const { data } = await admin
    .from("ai_draft_history")
    .select("revision_number")
    .eq("message_id", messageId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last =
    (data as { revision_number?: number } | null)?.revision_number ?? 0;
  return last + 1;
}

/**
 * Low-level insert. Use the higher-level helpers below unless you're hand-
 * crafting a revision row from outside the normal lifecycle.
 */
export async function insertDraftRevision(
  admin: SupabaseClient,
  row: DraftHistoryRow,
): Promise<{ ok: boolean; revisionNumber: number | null }> {
  try {
    const revisionNumber = await nextRevisionNumber(admin, row.messageId);
    const { error } = await admin.from("ai_draft_history").insert({
      firm_id: row.firmId,
      message_id: row.messageId ?? null,
      conversation_id: row.conversationId ?? null,
      lead_id: row.leadId ?? null,
      approval_queue_id: row.approvalQueueId ?? null,
      ai_job_id: row.aiJobId ?? null,
      content: row.content,
      source: row.source,
      redraft_instructions: row.redraftInstructions ?? null,
      ai_model: row.aiModel ?? null,
      actor_id: row.actorId ?? null,
      revision_number: revisionNumber,
      context_snapshot: row.contextSnapshot ?? null,
      channel: row.channel ?? null,
    });
    if (error) {
      console.error("[draft-history] insert failed:", error.message);
      return { ok: false, revisionNumber: null };
    }
    return { ok: true, revisionNumber };
  } catch (err) {
    console.error("[draft-history] unexpected error:", err);
    return { ok: false, revisionNumber: null };
  }
}

export async function recordAiInitialDraft(args: {
  admin: SupabaseClient;
  firmId: string;
  messageId: string;
  content: string;
  conversationId?: string | null;
  leadId?: string | null;
  channel?: string | null;
  aiModel?: string | null;
  aiJobId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
}): Promise<void> {
  await insertDraftRevision(args.admin, {
    firmId: args.firmId,
    source: "ai_initial",
    content: args.content,
    messageId: args.messageId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    channel: args.channel,
    aiModel: args.aiModel,
    aiJobId: args.aiJobId,
    contextSnapshot: args.contextSnapshot,
  });
}

/**
 * Records a human-instructed redraft. If no prior history exists for the
 * message (because initial-draft capture wasn't wired yet at the time it
 * was created), we synthesize an 'ai_initial' row from the pre-redraft
 * content so the lineage is complete.
 */
export async function recordRedraft(args: {
  admin: SupabaseClient;
  firmId: string;
  messageId: string;
  oldContent: string;
  newContent: string;
  instructions: string;
  conversationId?: string | null;
  leadId?: string | null;
  approvalQueueId?: string | null;
  channel?: string | null;
  aiModel?: string | null;
  aiJobId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
}): Promise<void> {
  // Has anything been captured for this message yet?
  const { data: existing } = await args.admin
    .from("ai_draft_history")
    .select("id")
    .eq("message_id", args.messageId)
    .limit(1);

  if (!existing || existing.length === 0) {
    // Backfill the initial draft from what was in messages.content before
    // we mutated it.
    await insertDraftRevision(args.admin, {
      firmId: args.firmId,
      source: "ai_initial",
      content: args.oldContent,
      messageId: args.messageId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      approvalQueueId: args.approvalQueueId,
      channel: args.channel,
      contextSnapshot: args.contextSnapshot,
    });
  }

  await insertDraftRevision(args.admin, {
    firmId: args.firmId,
    source: "ai_redraft",
    content: args.newContent,
    messageId: args.messageId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    approvalQueueId: args.approvalQueueId,
    aiJobId: args.aiJobId,
    aiModel: args.aiModel,
    redraftInstructions: args.instructions,
    channel: args.channel,
    contextSnapshot: args.contextSnapshot,
  });
}

export async function recordHumanEdit(args: {
  admin: SupabaseClient;
  firmId: string;
  messageId: string;
  oldContent: string;
  newContent: string;
  actorId: string;
  conversationId?: string | null;
  leadId?: string | null;
  approvalQueueId?: string | null;
  channel?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
}): Promise<void> {
  // No-op if content unchanged.
  if (args.oldContent.trim() === args.newContent.trim()) return;

  const { data: existing } = await args.admin
    .from("ai_draft_history")
    .select("id")
    .eq("message_id", args.messageId)
    .limit(1);

  if (!existing || existing.length === 0) {
    // Synthesize an 'ai_initial' from the pre-edit content so the human edit
    // has a parent to diff against.
    await insertDraftRevision(args.admin, {
      firmId: args.firmId,
      source: "ai_initial",
      content: args.oldContent,
      messageId: args.messageId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      approvalQueueId: args.approvalQueueId,
      channel: args.channel,
      contextSnapshot: args.contextSnapshot,
    });
  }

  await insertDraftRevision(args.admin, {
    firmId: args.firmId,
    source: "human_edit",
    content: args.newContent,
    messageId: args.messageId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    approvalQueueId: args.approvalQueueId,
    actorId: args.actorId,
    channel: args.channel,
    contextSnapshot: args.contextSnapshot,
  });
}

/**
 * Capture a snapshot of the lead + conversation context at the time of an
 * AI draft / human edit. This is the "what was the model looking at?" half
 * of the training row; pair it with the content the model produced.
 */
export async function buildContextSnapshot(
  admin: SupabaseClient,
  args: { firmId: string; leadId?: string | null; conversationId?: string | null },
): Promise<Record<string, unknown> | null> {
  const snap: Record<string, unknown> = {};
  if (args.leadId) {
    const { data: lead } = await admin
      .from("leads")
      .select("id, full_name, source, status, payload")
      .eq("id", args.leadId)
      .eq("firm_id", args.firmId)
      .maybeSingle();
    if (lead) {
      const payload = (lead.payload ?? {}) as Record<string, unknown>;
      snap.lead = {
        id: lead.id,
        full_name: lead.full_name,
        source: lead.source,
        status: lead.status,
        matter_type: payload.matter_type ?? null,
        description_summary: payload.description_summary ?? null,
        client_description: payload.client_description ?? null,
        list_name: payload.list_name ?? null,
        state: payload.state ?? null,
        timezone: payload.timezone ?? null,
      };
    }
  }
  if (args.conversationId) {
    const { data: msgs } = await admin
      .from("messages")
      .select("direction, content, channel, created_at")
      .eq("conversation_id", args.conversationId)
      .order("created_at", { ascending: false })
      .limit(8);
    snap.recent_messages = (msgs ?? [])
      .reverse()
      .map((m) => ({
        direction: m.direction,
        channel: m.channel,
        content: typeof m.content === "string" ? m.content.slice(0, 2000) : null,
        created_at: m.created_at,
      }));
  }
  return Object.keys(snap).length > 0 ? snap : null;
}
