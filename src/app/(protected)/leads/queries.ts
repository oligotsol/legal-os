import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeadListItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  channel: string | null;
  classificationMatterType: string | null;
  classificationConfidence: number | null;
  conversationId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function fetchLeadsList(
  supabase: SupabaseClient,
  filter?: { status?: string },
): Promise<LeadListItem[]> {
  let query = supabase
    .from("leads")
    .select("*, classifications(matter_type, confidence, is_current), conversations(id)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (filter?.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  return (data ?? []).map((lead) => {
    const classifications = lead.classifications as Array<{
      matter_type: string;
      confidence: number;
      is_current: boolean;
    }> | null;

    const currentClassification = classifications?.find((c) => c.is_current) ?? null;

    const conversations = lead.conversations as Array<{ id: string }> | null;
    const conversationId = conversations?.[0]?.id ?? null;

    return {
      id: lead.id,
      fullName: lead.full_name ?? "Unknown",
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      status: lead.status,
      channel: lead.channel,
      classificationMatterType: currentClassification?.matter_type ?? null,
      classificationConfidence: currentClassification
        ? Math.round(currentClassification.confidence * 100)
        : null,
      conversationId,
      createdAt: lead.created_at,
    };
  });
}
