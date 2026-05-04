import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationListItem {
  id: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  channel: string | null;
  status: string;
  phase: string;
  lastMessageAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  hasEthicsFlags: boolean;
}

export interface ConversationThread {
  id: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactState: string | null;
  channel: string | null;
  status: string;
  phase: string;
  messageCount: number;
  context: Record<string, unknown> | null;
  messages: ThreadMessage[];
  classification: {
    matterType: string;
    confidence: number;
  } | null;
  leadId: string | null;
  leadStatus: string | null;
  contactId: string | null;
  /** Set when an AI draft is waiting on this conversation. Lets the
   *  conversation panel render an inline approve/send affordance so the
   *  attorney never has to context-switch to /approvals to dispatch a reply. */
  pendingApproval: {
    queueItemId: string;
    messageId: string;
    content: string;
    channel: string | null;
  } | null;
}

export interface ThreadMessage {
  id: string;
  direction: string;
  channel: string | null;
  content: string | null;
  senderType: string;
  status: string;
  aiGenerated: boolean;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "\u2026";
}

function hasEthicsSignals(context: Record<string, unknown> | null): boolean {
  if (!context) return false;
  const signals = context.ethics_signals;
  if (Array.isArray(signals) && signals.length > 0) return true;
  if (typeof signals === "object" && signals !== null && Object.keys(signals).length > 0)
    return true;
  return false;
}

// ---------------------------------------------------------------------------
// fetchConversations
// ---------------------------------------------------------------------------

export async function fetchConversations(
  supabase: SupabaseClient,
  filter?: { status?: string }
): Promise<ConversationListItem[]> {
  let query = supabase
    .from("conversations")
    .select("*, contacts(full_name, email, phone)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (filter?.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  const conversations = data ?? [];

  // Fetch last message preview for each conversation
  const conversationIds = conversations.map((c) => c.id);

  let messageMap: Record<string, string> = {};

  if (conversationIds.length > 0) {
    // Fetch the most recent message for each conversation.
    // Supabase doesn't support window functions directly, so we fetch
    // the most recent messages and group them client-side.
    const { data: messages } = await supabase
      .from("messages")
      .select("conversation_id, content")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(conversationIds.length * 2); // fetch enough to cover all convos

    if (messages) {
      for (const msg of messages) {
        if (!messageMap[msg.conversation_id] && msg.content) {
          messageMap[msg.conversation_id] = msg.content;
        }
      }
    }
  }

  return conversations.map((c) => {
    const contactRaw = c.contacts as unknown;
    const contact = (
      Array.isArray(contactRaw) ? contactRaw[0] : contactRaw
    ) as { full_name: string; email: string | null; phone: string | null } | null;

    const preview = messageMap[c.id] ?? null;

    return {
      id: c.id,
      contactName: contact?.full_name ?? "Unknown Contact",
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? null,
      channel: c.channel,
      status: c.status,
      phase: c.phase,
      lastMessageAt: c.last_message_at,
      messageCount: c.message_count ?? 0,
      lastMessagePreview: preview ? truncate(preview, 100) : null,
      hasEthicsFlags: hasEthicsSignals(c.context),
    };
  });
}

// ---------------------------------------------------------------------------
// fetchConversationThread
// ---------------------------------------------------------------------------

export async function fetchConversationThread(
  supabase: SupabaseClient,
  conversationId: string
): Promise<ConversationThread | null> {
  // Fetch conversation with contact join
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("*, contacts(full_name, email, phone, state)")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return null;
  }

  // Fetch all messages for this conversation
  const { data: messages, error: msgError } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (msgError) {
    throw new Error(`Failed to fetch messages: ${msgError.message}`);
  }

  // Fetch classification if conversation has a lead_id
  let classification: ConversationThread["classification"] = null;

  if (conversation.lead_id) {
    const { data: classificationData } = await supabase
      .from("classifications")
      .select("matter_type, confidence")
      .eq("lead_id", conversation.lead_id)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (classificationData) {
      classification = {
        matterType: classificationData.matter_type,
        confidence: Math.round(classificationData.confidence * 100),
      };
    }
  }

  const contactRaw = conversation.contacts as unknown;
  const contact = (
    Array.isArray(contactRaw) ? contactRaw[0] : contactRaw
  ) as {
    full_name: string;
    email: string | null;
    phone: string | null;
    state: string | null;
  } | null;

  // Fetch lead status if lead_id exists
  let leadStatus: string | null = null;
  if (conversation.lead_id) {
    const { data: leadRow } = await supabase
      .from("leads")
      .select("status")
      .eq("id", conversation.lead_id)
      .maybeSingle();

    leadStatus = (leadRow?.status as string) ?? null;
  }

  // Resolve pending approval for the most recent AI draft, if any.
  let pendingApproval: ConversationThread["pendingApproval"] = null;
  const pendingMsg = (messages ?? [])
    .slice()
    .reverse()
    .find(
      (m) => m.status === "pending_approval" && m.ai_generated === true,
    );
  if (pendingMsg) {
    const { data: q } = await supabase
      .from("approval_queue")
      .select("id")
      .eq("entity_id", pendingMsg.id)
      .eq("entity_type", "message")
      .eq("status", "pending")
      .maybeSingle();
    if (q) {
      pendingApproval = {
        queueItemId: q.id,
        messageId: pendingMsg.id,
        content: (pendingMsg.content as string) ?? "",
        channel: (pendingMsg.channel as string) ?? null,
      };
    }
  }

  return {
    id: conversation.id,
    contactName: contact?.full_name ?? "Unknown Contact",
    contactEmail: contact?.email ?? null,
    contactPhone: contact?.phone ?? null,
    contactState: contact?.state ?? null,
    channel: conversation.channel,
    status: conversation.status,
    phase: conversation.phase,
    messageCount: conversation.message_count ?? 0,
    context: conversation.context,
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      content: m.content,
      senderType: m.sender_type,
      status: m.status,
      aiGenerated: m.ai_generated,
      createdAt: m.created_at,
      metadata: m.metadata,
    })),
    classification,
    leadId: conversation.lead_id ?? null,
    leadStatus,
    contactId: conversation.contact_id ?? null,
    pendingApproval,
  };
}
