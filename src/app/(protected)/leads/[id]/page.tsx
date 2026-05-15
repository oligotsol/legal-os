import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchConversationThread, type ConversationThread } from "../../conversations/queries";
import { LeadDetail, type LeadDetailData } from "./lead-detail";

export const dynamic = "force-dynamic";

interface LeadPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compose?: string; conversation?: string }>;
}

export default async function LeadPage({ params, searchParams }: LeadPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const compose = sp.compose === "sms" || sp.compose === "email" ? sp.compose : null;

  const supabase = await createClient();

  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      "*, contacts:contact_id(id, full_name, email, phone, state, dnc), conversations(id, status, channel, last_message_at), classifications(matter_type, confidence, is_current)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !lead) {
    notFound();
  }

  const contactRaw = lead.contacts as unknown;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    state: string | null;
    dnc: boolean;
  } | null;

  // Pick the conversation to render. Honor ?conversation= when provided
  // (handy when arriving from /conversations); otherwise the most recent.
  const conversations = (lead.conversations ?? []) as Array<{
    id: string;
    last_message_at: string | null;
  }>;
  const preferredConversationId =
    sp.conversation && conversations.find((c) => c.id === sp.conversation)?.id;
  const conversationId =
    preferredConversationId ??
    conversations
      .slice()
      .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0]?.id ??
    null;

  const thread: ConversationThread | null = conversationId
    ? await fetchConversationThread(supabase, conversationId)
    : null;

  const classifications = (lead.classifications ?? []) as Array<{
    matter_type: string;
    confidence: number;
    is_current: boolean;
  }>;
  const currentClassification = classifications.find((c) => c.is_current) ?? null;

  const payload = (lead.payload ?? {}) as Record<string, unknown>;

  const rawNotes = Array.isArray(payload.notes) ? payload.notes : [];
  const notes = rawNotes
    .map((n) => {
      if (!n || typeof n !== "object") return null;
      const e = n as Record<string, unknown>;
      const body = typeof e.body === "string" ? e.body : null;
      const addedAt = typeof e.added_at === "string" ? e.added_at : null;
      if (!body || !addedAt) return null;
      return {
        body,
        addedAt,
        addedBy: typeof e.added_by === "string" ? e.added_by : null,
        source: typeof e.source === "string" ? e.source : null,
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  const data: LeadDetailData = {
    leadId: lead.id,
    leadStatus: lead.status,
    leadSource: lead.source,
    leadChannel: lead.channel,
    leadCreatedAt: lead.created_at,
    fullName: contact?.full_name ?? lead.full_name ?? "Unknown",
    email: contact?.email ?? lead.email ?? null,
    phone: contact?.phone ?? lead.phone ?? null,
    state: contact?.state ?? null,
    dnc: contact?.dnc ?? false,
    contactId: contact?.id ?? null,
    clientDescription: (payload.client_description as string | undefined) ?? null,
    matterType:
      currentClassification?.matter_type ??
      (payload.matter_type as string | undefined) ??
      null,
    classificationConfidence: currentClassification
      ? Math.round(currentClassification.confidence * 100)
      : null,
    caseId: (payload.case_id as string | undefined) ?? null,
    city: (payload.city as string | undefined) ?? null,
    notes,
    thread,
    initialCompose: compose,
  };

  return <LeadDetail data={data} />;
}
