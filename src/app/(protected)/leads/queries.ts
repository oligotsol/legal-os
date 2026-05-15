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
  /** Set on CSV-imported leads — the human-readable list name the user
   *  supplied at import time (e.g. "LegalMatch Q1 2026"). */
  listName: string | null;
  status: string;
  channel: string | null;
  /** Short concise description shown in the table column. AI-generated
   *  on lead creation, falling back to client_description / matter_type. */
  description: string | null;
  /** Longer rich description shown in the hover tooltip and lead detail page.
   *  Null when no full body is available (e.g. SMS leads). */
  descriptionFull: string | null;
  /** ISO timestamp of the most recent message in any conversation tied to this
   *  lead. Null when no inbound/outbound has happened yet. */
  lastContactAt: string | null;
  classificationMatterType: string | null;
  classificationConfidence: number | null;
  conversationId: string | null;
  createdAt: string;
  /** Two-letter state code (e.g. "TX", "PA") or null if the lead's state
   *  hasn't been determined yet. Drives jurisdiction routing. */
  state: string | null;
  /** Attorney of record assigned to this lead based on its state. Populated
   *  at intake from firm_config.attorney_of_record_by_jurisdiction. */
  assignedAttorneyName: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface LeadsListResult {
  leads: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const DEFAULT_LEADS_PAGE_SIZE = 50;

export async function fetchLeadsList(
  supabase: SupabaseClient,
  filter?: { status?: string; page?: number; pageSize?: number },
): Promise<LeadsListResult> {
  const pageSize = filter?.pageSize ?? DEFAULT_LEADS_PAGE_SIZE;
  const page = Math.max(1, filter?.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // We join contacts because most inbound-created leads keep their name on
  // the *contact* row, not `leads.full_name`. Without this join the list
  // shows "Unknown" for every email/SMS lead even when the contact has a
  // proper name. Lead-level full_name still wins when set (manual creates).
  let query = supabase
    .from("leads")
    .select(
      "*, contacts:contact_id(full_name, email, phone), classifications(matter_type, confidence, is_current), conversations(id, last_message_at)",
      { count: "exact" },
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filter?.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const leads = (data ?? []).map((lead) => {
    const classifications = lead.classifications as Array<{
      matter_type: string;
      confidence: number;
      is_current: boolean;
    }> | null;

    const currentClassification =
      classifications?.find((c) => c.is_current) ?? null;

    const conversations = lead.conversations as Array<{
      id: string;
      last_message_at: string | null;
    }> | null;
    const conversationId = conversations?.[0]?.id ?? null;
    const lastContactAt =
      conversations?.reduce<string | null>((latest, c) => {
        if (!c.last_message_at) return latest;
        if (!latest) return c.last_message_at;
        return c.last_message_at > latest ? c.last_message_at : latest;
      }, null) ?? null;

    const contactRaw = lead.contacts as unknown;
    const contact = (
      Array.isArray(contactRaw) ? contactRaw[0] : contactRaw
    ) as { full_name: string; email: string | null; phone: string | null } | null;

    const payload = (lead.payload ?? {}) as Record<string, unknown>;
    // Prefer the AI-generated services-list summary (concise, tight).
    // Fall back to longer client_description, then matter_type. The lead
    // list cell shows this; hover tooltip surfaces client_description for
    // the full context when present.
    const description =
      (payload.description_summary as string | undefined) ??
      (payload.client_description as string | undefined) ??
      (payload.matter_type as string | undefined) ??
      null;
    const descriptionFull =
      (payload.client_description as string | undefined) ?? null;

    // Name priority: lead.full_name (manual creates) → contact.full_name
    // (inbound flow) → email/phone → "Unknown" as last resort.
    const fullName =
      lead.full_name ??
      contact?.full_name ??
      lead.email ??
      lead.phone ??
      contact?.email ??
      contact?.phone ??
      "Unknown";

    return {
      id: lead.id,
      fullName,
      email: lead.email ?? contact?.email ?? null,
      phone: lead.phone ?? contact?.phone ?? null,
      source: lead.source,
      listName: (payload.list_name as string | undefined) ?? null,
      status: lead.status,
      channel: lead.channel,
      description,
      descriptionFull,
      lastContactAt,
      classificationMatterType: currentClassification?.matter_type ?? null,
      classificationConfidence: currentClassification
        ? Math.round(currentClassification.confidence * 100)
        : null,
      conversationId,
      createdAt: lead.created_at,
      state: (lead.state as string | null) ?? null,
      assignedAttorneyName:
        (lead.assigned_attorney_name as string | null) ?? null,
    };
  });

  return {
    leads,
    total: count ?? leads.length,
    page,
    pageSize,
  };
}
