/**
 * Dashboard server-side data fetching functions.
 *
 * All functions accept a Supabase client scoped to the current user's
 * session (RLS enforced). They return plain data for Server Components.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSlaColor, type SlaColor } from "@/lib/pipeline/transitions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineFunnelItem {
  stageId: string;
  slug: string;
  name: string;
  stageType: string;
  displayOrder: number;
  count: number;
  totalFeeValue: number;
}

export interface SlaQueueItem {
  matterId: string;
  contactName: string;
  stageName: string;
  stageSlug: string;
  slaColor: SlaColor;
  slaHours: number | null;
  enteredAt: string;
  hoursRemaining: number | null;
}

export interface ActiveMatter {
  id: string;
  contactName: string;
  matterType: string | null;
  stageName: string;
  assignedTo: string | null;
  totalFee: number | null;
  createdAt: string;
}

export interface AiSpendItem {
  purpose: string;
  totalCostCents: number;
  jobCount: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export interface ApprovalSummary {
  actionType: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Pipeline funnel: count of matters + total fee value per non-terminal stage.
 */
export async function fetchPipelineFunnel(
  supabase: SupabaseClient,
): Promise<PipelineFunnelItem[]> {
  // Fetch non-terminal stages
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id, slug, name, stage_type, display_order")
    .eq("is_terminal", false)
    .order("display_order");

  if (!stages || stages.length === 0) return [];

  // Fetch matters grouped by stage
  const { data: matters } = await supabase
    .from("matters")
    .select("stage_id, fee_quotes(total_quoted_fee)")
    .in("status", ["active", "on_hold"]);

  const stageMap = new Map<string, { count: number; totalFee: number }>();
  for (const m of matters ?? []) {
    if (!m.stage_id) continue;
    const entry = stageMap.get(m.stage_id) ?? { count: 0, totalFee: 0 };
    entry.count++;
    // fee_quotes is an array of related fee quotes
    const quotes = m.fee_quotes as Array<{ total_quoted_fee: number }> | null;
    if (quotes && quotes.length > 0) {
      entry.totalFee += quotes[0].total_quoted_fee ?? 0;
    }
    stageMap.set(m.stage_id, entry);
  }

  return stages.map((s) => ({
    stageId: s.id,
    slug: s.slug,
    name: s.name,
    stageType: s.stage_type,
    displayOrder: s.display_order,
    count: stageMap.get(s.id)?.count ?? 0,
    totalFeeValue: stageMap.get(s.id)?.totalFee ?? 0,
  }));
}

/**
 * SLA queue: matters with SLA urgency, sorted CRITICAL-first.
 */
export async function fetchSlaQueue(
  supabase: SupabaseClient,
): Promise<SlaQueueItem[]> {
  const { data } = await supabase
    .from("matters")
    .select(`
      id,
      contacts(full_name),
      pipeline_stages(name, slug, sla_hours),
      matter_stage_history(created_at)
    `)
    .in("status", ["active", "on_hold"])
    .not("stage_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (!data) return [];

  const items: SlaQueueItem[] = [];

  for (const m of data) {
    const stageRaw = m.pipeline_stages as unknown;
    const stage = (Array.isArray(stageRaw) ? stageRaw[0] : stageRaw) as { name: string; slug: string; sla_hours: number | null } | null;
    if (!stage || stage.sla_hours == null) continue;

    const contactRaw = m.contacts as unknown;
    const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as { full_name: string } | null;
    const history = m.matter_stage_history as Array<{ created_at: string }> | null;
    const enteredAt = history?.[history.length - 1]?.created_at ?? new Date().toISOString();

    const slaColor = computeSlaColor(enteredAt, stage.sla_hours);
    if (slaColor === "NONE") continue;

    const elapsedHours = (Date.now() - new Date(enteredAt).getTime()) / (1000 * 60 * 60);
    const hoursRemaining = stage.sla_hours - elapsedHours;

    items.push({
      matterId: m.id,
      contactName: contact?.full_name ?? "Unknown",
      stageName: stage.name,
      stageSlug: stage.slug,
      slaColor,
      slaHours: stage.sla_hours,
      enteredAt,
      hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    });
  }

  // Sort: CRITICAL first, then RED, ORANGE, YELLOW, GREEN
  const colorOrder: Record<SlaColor, number> = {
    CRITICAL: 0, RED: 1, ORANGE: 2, YELLOW: 3, GREEN: 4, NONE: 5,
  };
  items.sort((a, b) => colorOrder[a.slaColor] - colorOrder[b.slaColor]);

  return items;
}

/**
 * Active matters: post-engagement matters with contact + stage info.
 */
export async function fetchActiveMatters(
  supabase: SupabaseClient,
): Promise<ActiveMatter[]> {
  const { data } = await supabase
    .from("matters")
    .select(`
      id,
      matter_type,
      assigned_to,
      created_at,
      contacts(full_name),
      pipeline_stages(name),
      fee_quotes(total_quoted_fee)
    `)
    .in("status", ["active", "on_hold"])
    .order("created_at", { ascending: false })
    .limit(25);

  if (!data) return [];

  return data.map((m) => {
    const contactRaw = m.contacts as unknown;
    const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as { full_name: string } | null;
    const stageRaw = m.pipeline_stages as unknown;
    const stage = (Array.isArray(stageRaw) ? stageRaw[0] : stageRaw) as { name: string } | null;
    const quotes = m.fee_quotes as Array<{ total_quoted_fee: number }> | null;

    return {
      id: m.id,
      contactName: contact?.full_name ?? "Unknown",
      matterType: m.matter_type,
      stageName: stage?.name ?? "Unassigned",
      assignedTo: m.assigned_to,
      totalFee: quotes?.[0]?.total_quoted_fee ?? null,
      createdAt: m.created_at,
    };
  });
}

/**
 * AI spend: aggregate ai_jobs by purpose over last N days.
 */
export async function fetchAiSpend(
  supabase: SupabaseClient,
  days: number = 30,
): Promise<{ items: AiSpendItem[]; totalCostCents: number }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("ai_jobs")
    .select("purpose, cost_cents")
    .gte("created_at", since)
    .eq("status", "completed");

  if (!data || data.length === 0) return { items: [], totalCostCents: 0 };

  const byPurpose = new Map<string, { totalCostCents: number; jobCount: number }>();
  let totalCostCents = 0;

  for (const job of data) {
    const entry = byPurpose.get(job.purpose) ?? { totalCostCents: 0, jobCount: 0 };
    entry.totalCostCents += job.cost_cents ?? 0;
    entry.jobCount++;
    totalCostCents += job.cost_cents ?? 0;
    byPurpose.set(job.purpose, entry);
  }

  const items = Array.from(byPurpose.entries()).map(([purpose, v]) => ({
    purpose,
    totalCostCents: v.totalCostCents,
    jobCount: v.jobCount,
  }));

  items.sort((a, b) => b.totalCostCents - a.totalCostCents);

  return { items, totalCostCents };
}

/**
 * Recent audit log entries.
 */
export async function fetchRecentAuditEntries(
  supabase: SupabaseClient,
  limit: number = 20,
): Promise<AuditEntry[]> {
  const { data } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((e) => ({
    id: e.id,
    action: e.action,
    entityType: e.entity_type,
    entityId: e.entity_id,
    createdAt: e.created_at,
  }));
}

/**
 * Approval summary: pending counts by action type.
 */
export async function fetchApprovalSummary(
  supabase: SupabaseClient,
): Promise<ApprovalSummary[]> {
  const { data } = await supabase
    .from("approval_queue")
    .select("action_type")
    .eq("status", "pending");

  if (!data || data.length === 0) return [];

  const counts = new Map<string, number>();
  for (const item of data) {
    counts.set(item.action_type, (counts.get(item.action_type) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([actionType, count]) => ({
    actionType,
    count,
  }));
}
