import { createClient } from "@/lib/supabase/server";
import type { ApprovalActionType, ApprovalQueueItem } from "@/types/database";

export interface EnrichedQueueItem extends ApprovalQueueItem {
  contact_name: string | null;
  entity_summary: string | null;
}

function enrichQueueItem(item: ApprovalQueueItem): EnrichedQueueItem {
  const meta = item.metadata as Record<string, unknown> | null;
  return {
    ...item,
    contact_name: (meta?.contact_name as string) ?? null,
    entity_summary: (meta?.summary as string) ?? null,
  };
}

export async function fetchPendingApprovals(
  filter?: ApprovalActionType
): Promise<EnrichedQueueItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("approval_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (filter) {
    query = query.eq("action_type", filter);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch approvals: ${error.message}`);
  }

  return (data ?? []).map(enrichQueueItem);
}

export async function fetchApprovalCounts(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("approval_queue")
    .select("action_type")
    .eq("status", "pending");

  if (error) {
    throw new Error(`Failed to fetch approval counts: ${error.message}`);
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const type = row.action_type;
    counts[type] = (counts[type] ?? 0) + 1;
  }

  return counts;
}
