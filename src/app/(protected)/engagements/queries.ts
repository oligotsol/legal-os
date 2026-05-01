import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngagementLetterStatus } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngagementListItem {
  id: string;
  contactName: string;
  contactEmail: string | null;
  matterType: string | null;
  jurisdiction: string | null;
  stateCode: string | null;
  totalFee: number | null;
  status: EngagementLetterStatus;
  templateKey: string | null;
  createdAt: string;
  sentAt: string | null;
  signedAt: string | null;
}

export interface EngagementDetail {
  id: string;
  contactName: string;
  contactEmail: string | null;
  matterType: string | null;
  matterId: string;
  jurisdiction: string | null;
  stateCode: string | null;
  stateName: string | null;
  status: EngagementLetterStatus;
  templateKey: string | null;
  variables: Record<string, unknown>;
  feeQuote: {
    id: string;
    totalQuotedFee: number;
    lineItems: Array<{ serviceName: string; amount: number }>;
  } | null;
  eSignProvider: string | null;
  eSignEnvelopeId: string | null;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  signedAt: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function fetchEngagementLetters(
  supabase: SupabaseClient,
  filter?: { status?: string },
): Promise<EngagementListItem[]> {
  let query = supabase
    .from("engagement_letters")
    .select(`
      id, status, template_key, created_at, sent_at, signed_at,
      matters(matter_type, jurisdiction, contacts(full_name, email)),
      fee_quotes(total_quoted_fee),
      jurisdictions(state_code)
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (filter?.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch engagement letters: ${error.message}`);
  }

  return (data ?? []).map((el) => {
    const matterRaw = el.matters as unknown;
    const matter = (Array.isArray(matterRaw) ? matterRaw[0] : matterRaw) as {
      matter_type: string | null;
      jurisdiction: string | null;
      contacts: unknown;
    } | null;

    const contactRaw = matter?.contacts as unknown;
    const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
      full_name: string;
      email: string | null;
    } | null;

    const fqRaw = el.fee_quotes as unknown;
    const fq = (Array.isArray(fqRaw) ? fqRaw[0] : fqRaw) as {
      total_quoted_fee: number;
    } | null;

    const jurRaw = el.jurisdictions as unknown;
    const jur = (Array.isArray(jurRaw) ? jurRaw[0] : jurRaw) as {
      state_code: string;
    } | null;

    return {
      id: el.id,
      contactName: contact?.full_name ?? "Unknown",
      contactEmail: contact?.email ?? null,
      matterType: matter?.matter_type ?? null,
      jurisdiction: matter?.jurisdiction ?? null,
      stateCode: jur?.state_code ?? null,
      totalFee: fq?.total_quoted_fee ?? null,
      status: el.status as EngagementLetterStatus,
      templateKey: el.template_key,
      createdAt: el.created_at,
      sentAt: el.sent_at,
      signedAt: el.signed_at,
    };
  });
}

export async function fetchEngagementDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<EngagementDetail | null> {
  const { data: el, error } = await supabase
    .from("engagement_letters")
    .select(`
      *,
      matters(id, matter_type, jurisdiction, contacts(full_name, email)),
      fee_quotes(id, total_quoted_fee, line_items),
      jurisdictions(state_code, state_name)
    `)
    .eq("id", id)
    .single();

  if (error || !el) return null;

  const matterRaw = el.matters as unknown;
  const matter = (Array.isArray(matterRaw) ? matterRaw[0] : matterRaw) as {
    id: string;
    matter_type: string | null;
    jurisdiction: string | null;
    contacts: unknown;
  } | null;

  const contactRaw = matter?.contacts as unknown;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    full_name: string;
    email: string | null;
  } | null;

  const fqRaw = el.fee_quotes as unknown;
  const fq = (Array.isArray(fqRaw) ? fqRaw[0] : fqRaw) as {
    id: string;
    total_quoted_fee: number;
    line_items: Array<Record<string, unknown>>;
  } | null;

  const jurRaw = el.jurisdictions as unknown;
  const jur = (Array.isArray(jurRaw) ? jurRaw[0] : jurRaw) as {
    state_code: string;
    state_name: string;
  } | null;

  return {
    id: el.id,
    contactName: contact?.full_name ?? "Unknown",
    contactEmail: contact?.email ?? null,
    matterType: matter?.matter_type ?? null,
    matterId: matter?.id ?? el.matter_id,
    jurisdiction: matter?.jurisdiction ?? null,
    stateCode: jur?.state_code ?? null,
    stateName: jur?.state_name ?? null,
    status: el.status as EngagementLetterStatus,
    templateKey: el.template_key,
    variables: (el.variables as Record<string, unknown>) ?? {},
    feeQuote: fq
      ? {
          id: fq.id,
          totalQuotedFee: fq.total_quoted_fee,
          lineItems: (fq.line_items ?? []).map((item) => ({
            serviceName: (item.service_name as string) ?? "Service",
            amount: (item.subtotal as number) ?? 0,
          })),
        }
      : null,
    eSignProvider: el.e_sign_provider,
    eSignEnvelopeId: el.e_sign_envelope_id,
    createdAt: el.created_at,
    approvedAt: el.approved_at,
    sentAt: el.sent_at,
    signedAt: el.signed_at,
  };
}
