/**
 * Pipeline server-side data fetching functions.
 *
 * All functions accept a Supabase client scoped to the current user's
 * session (RLS enforced). They return plain data for Server Components.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSlaColor, type SlaColor } from "@/lib/pipeline/transitions";
import type { PipelineStage, StageType } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStageWithCounts {
  id: string;
  slug: string;
  name: string;
  stageType: StageType;
  displayOrder: number;
  matterCount: number;
  totalFeeValue: number;
}

export interface PipelineMatter {
  id: string;
  contactName: string;
  stageSlug: string;
  stageName: string;
  fee: number | null;
  slaColor: SlaColor;
  createdAt: string;
  updatedAt: string;
}

export interface MatterDetail {
  id: string;
  matterType: string | null;
  status: string;
  jurisdiction: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    fullName: string;
    email: string | null;
    phone: string | null;
    state: string | null;
  } | null;
  stage: {
    id: string;
    name: string;
    slug: string;
    slaHours: number | null;
  } | null;
  slaColor: SlaColor;
  classification: {
    matterType: string;
    confidence: number;
  } | null;
  feeQuote: {
    id: string;
    totalQuotedFee: number;
    status: string;
  } | null;
  allowedTransitions: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  stageHistory: Array<{
    id: string;
    fromStageName: string | null;
    toStageName: string;
    reason: string | null;
    createdAt: string;
  }>;
  conversations: Array<{
    id: string;
    status: string;
    phase: string;
    messageCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch all non-terminal stages with matter counts and total fee values.
 */
export async function fetchStagesWithCounts(
  supabase: SupabaseClient,
): Promise<PipelineStageWithCounts[]> {
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id, slug, name, stage_type, display_order")
    .eq("is_terminal", false)
    .order("display_order");

  if (!stages || stages.length === 0) return [];

  // Fetch matters with fee quotes to compute counts and fee sums
  const { data: matters } = await supabase
    .from("matters")
    .select("stage_id, fee_quotes(total_quoted_fee)")
    .in("status", ["active", "on_hold"]);

  const stageMap = new Map<string, { count: number; totalFee: number }>();
  for (const m of matters ?? []) {
    if (!m.stage_id) continue;
    const entry = stageMap.get(m.stage_id) ?? { count: 0, totalFee: 0 };
    entry.count++;
    const quotes = m.fee_quotes as Array<{ total_quoted_fee: number }> | null;
    if (quotes && quotes.length > 0) {
      entry.totalFee += quotes[0].total_quoted_fee ?? 0;
    }
    stageMap.set(m.stage_id, entry);
  }

  return stages.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    stageType: s.stage_type as StageType,
    displayOrder: s.display_order,
    matterCount: stageMap.get(s.id)?.count ?? 0,
    totalFeeValue: stageMap.get(s.id)?.totalFee ?? 0,
  }));
}

/**
 * Fetch matters filtered by stage slug (null = all non-terminal stages).
 * Orders by SLA urgency (CRITICAL first), then updated_at desc. Limit 100.
 */
export async function fetchMattersForStage(
  supabase: SupabaseClient,
  stageSlug: string | null,
): Promise<PipelineMatter[]> {
  // If filtering by stage slug, resolve stage ID first
  let stageId: string | null = null;
  if (stageSlug) {
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("slug", stageSlug)
      .single();

    if (!stage) return [];
    stageId = stage.id;
  }

  let query = supabase
    .from("matters")
    .select(`
      id,
      created_at,
      updated_at,
      contacts(full_name),
      pipeline_stages(name, slug, sla_hours),
      fee_quotes(total_quoted_fee),
      matter_stage_history(created_at)
    `)
    .in("status", ["active", "on_hold"])
    .not("stage_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (stageId) {
    query = query.eq("stage_id", stageId);
  }

  const { data } = await query;
  if (!data) return [];

  const colorOrder: Record<SlaColor, number> = {
    CRITICAL: 0,
    RED: 1,
    ORANGE: 2,
    YELLOW: 3,
    GREEN: 4,
    NONE: 5,
  };

  const items: PipelineMatter[] = data.map((m) => {
    const contactRaw = m.contacts as unknown;
    const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
      full_name: string;
    } | null;

    const stageRaw = m.pipeline_stages as unknown;
    const stage = (Array.isArray(stageRaw) ? stageRaw[0] : stageRaw) as {
      name: string;
      slug: string;
      sla_hours: number | null;
    } | null;

    const quotes = m.fee_quotes as Array<{ total_quoted_fee: number }> | null;
    const history = m.matter_stage_history as Array<{ created_at: string }> | null;
    const enteredAt = history?.[history.length - 1]?.created_at ?? m.created_at;
    const slaColor = computeSlaColor(enteredAt, stage?.sla_hours ?? null);

    return {
      id: m.id,
      contactName: contact?.full_name ?? "Unknown",
      stageSlug: stage?.slug ?? "unknown",
      stageName: stage?.name ?? "Unassigned",
      fee: quotes?.[0]?.total_quoted_fee ?? null,
      slaColor,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    };
  });

  // Sort: CRITICAL first, then RED, ORANGE, YELLOW, GREEN, NONE; then by updated_at desc
  items.sort((a, b) => {
    const colorDiff = colorOrder[a.slaColor] - colorOrder[b.slaColor];
    if (colorDiff !== 0) return colorDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return items;
}

/**
 * Fetch detailed matter information for the detail sheet.
 */
export async function fetchMatterDetail(
  supabase: SupabaseClient,
  matterId: string,
): Promise<MatterDetail | null> {
  const { data: matter } = await supabase
    .from("matters")
    .select(`
      id,
      contact_id,
      matter_type,
      status,
      jurisdiction,
      summary,
      created_at,
      updated_at,
      lead_id,
      contacts(full_name, email, phone, state),
      pipeline_stages(id, name, slug, sla_hours)
    `)
    .eq("id", matterId)
    .single();

  if (!matter) return null;

  const contactRaw = matter.contacts as unknown;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    full_name: string;
    email: string | null;
    phone: string | null;
    state: string | null;
  } | null;

  const stageRaw = matter.pipeline_stages as unknown;
  const stage = (Array.isArray(stageRaw) ? stageRaw[0] : stageRaw) as {
    id: string;
    name: string;
    slug: string;
    sla_hours: number | null;
  } | null;

  // Fetch stage history with stage name lookups
  const { data: historyRows } = await supabase
    .from("matter_stage_history")
    .select("id, from_stage_id, to_stage_id, reason, created_at")
    .eq("matter_id", matterId)
    .order("created_at", { ascending: true });

  // Fetch all stages for name resolution and transition computation
  const { data: allStages } = await supabase
    .from("pipeline_stages")
    .select("id, name, slug, allowed_transitions");

  const stageNameMap = new Map(
    (allStages ?? []).map((s) => [s.id, s.name as string]),
  );

  const stageHistory = (historyRows ?? []).map((h) => ({
    id: h.id as string,
    fromStageName: h.from_stage_id ? stageNameMap.get(h.from_stage_id) ?? "Unknown" : null,
    toStageName: stageNameMap.get(h.to_stage_id) ?? "Unknown",
    reason: h.reason as string | null,
    createdAt: h.created_at as string,
  }));

  // Compute SLA color based on when matter entered current stage
  const lastHistoryEntry = stageHistory[stageHistory.length - 1];
  const enteredAt = lastHistoryEntry?.createdAt ?? matter.created_at;
  const slaColor = computeSlaColor(enteredAt, stage?.sla_hours ?? null);

  // Fetch classification if lead_id exists
  let classification: MatterDetail["classification"] = null;
  if (matter.lead_id) {
    const { data: classRow } = await supabase
      .from("classifications")
      .select("matter_type, confidence")
      .eq("lead_id", matter.lead_id)
      .eq("is_current", true)
      .maybeSingle();

    if (classRow) {
      classification = {
        matterType: classRow.matter_type as string,
        confidence: classRow.confidence as number,
      };
    }
  }

  // Fetch most recent fee quote
  const { data: feeQuoteRow } = await supabase
    .from("fee_quotes")
    .select("id, total_quoted_fee, status")
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const feeQuote = feeQuoteRow
    ? {
        id: feeQuoteRow.id as string,
        totalQuotedFee: feeQuoteRow.total_quoted_fee as number,
        status: feeQuoteRow.status as string,
      }
    : null;

  // Fetch conversations for this contact
  const contactId = matter.contact_id as string | undefined;
  let conversations: MatterDetail["conversations"] = [];
  if (contactId) {
    const { data: convoRows } = await supabase
      .from("conversations")
      .select("id, status, phase, message_count")
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(5);

    conversations = (convoRows ?? []).map((c) => ({
      id: c.id as string,
      status: c.status as string,
      phase: c.phase as string,
      messageCount: c.message_count as number,
    }));
  }

  return {
    id: matter.id,
    matterType: matter.matter_type,
    status: matter.status,
    jurisdiction: matter.jurisdiction,
    summary: matter.summary,
    createdAt: matter.created_at,
    updatedAt: matter.updated_at,
    contact: contact
      ? {
          fullName: contact.full_name,
          email: contact.email,
          phone: contact.phone,
          state: contact.state,
        }
      : null,
    stage: stage
      ? {
          id: stage.id,
          name: stage.name,
          slug: stage.slug,
          slaHours: stage.sla_hours,
        }
      : null,
    slaColor,
    classification,
    feeQuote,
    allowedTransitions: computeAllowedTransitions(stage?.id ?? null, allStages ?? []),
    stageHistory,
    conversations,
  };
}

/**
 * Compute allowed transitions from the current stage based on the
 * allowed_transitions array on the stage row.
 */
function computeAllowedTransitions(
  currentStageId: string | null,
  allStages: Array<{ id: string; name: string; slug: string; allowed_transitions: string[] }>,
): MatterDetail["allowedTransitions"] {
  if (!currentStageId) return [];

  const currentStage = allStages.find((s) => s.id === currentStageId);
  if (!currentStage) return [];

  const allowedIds = currentStage.allowed_transitions ?? [];
  const stageMap = new Map(allStages.map((s) => [s.id, s]));

  return allowedIds
    .map((id) => stageMap.get(id))
    .filter((s): s is { id: string; name: string; slug: string; allowed_transitions: string[] } => s != null)
    .map((s) => ({ id: s.id, name: s.name, slug: s.slug }));
}

/**
 * Fetch all pipeline stages (for transition validation).
 */
export async function fetchAllStages(
  supabase: SupabaseClient,
): Promise<PipelineStage[]> {
  const { data } = await supabase
    .from("pipeline_stages")
    .select("*")
    .order("display_order");

  return (data ?? []) as PipelineStage[];
}
