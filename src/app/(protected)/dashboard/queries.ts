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

export interface DialerFunnelWindow {
  /** Calls Garrison kicked off via the dialer. */
  callsPlaced: number;
  /** Calls he marked Connected (whether or not a matter was created). */
  connected: number;
  /** Leads that turned into a matter — counted by lead.converted_to_matter audit
   *  entries so we capture conversions whether they happened inline from the
   *  dialer or from /leads/[id] afterward. */
  matters: number;
  /** No-answer cadence triggers — proxy for "rang but didn't pick up". */
  noAnswers: number;
}

export interface DialerFunnel {
  today: DialerFunnelWindow;
  last7d: DialerFunnelWindow;
  last30d: DialerFunnelWindow;
  /** Rates derived from today's numbers. Null when divisor is 0. */
  todayRates: {
    connectRate: number | null; // connected / calls_placed
    convertRate: number | null; // matters / connected
    callToMatterRate: number | null; // matters / calls_placed
  };
}

export interface FreshReply {
  approvalQueueId: string;
  messageId: string;
  leadId: string | null;
  contactName: string;
  channel: "sms" | "email";
  /** What the prospect said (latest inbound on this conversation, capped). */
  inboundPreview: string | null;
  inboundAt: string | null;
  /** Preview of the AI draft that's waiting on Garrison. */
  draftPreview: string;
  approvalCreatedAt: string;
  /** Lead score tier ("hot" | "warm" etc.) — null when unscored. */
  leadScoreTier: "hot" | "warm" | "cool" | "cold" | "unknown" | null;
  /** Heuristic high-intent words detected in the inbound. */
  highIntent: boolean;
  /** Concrete signals lifted from the inbound for the UI to surface. */
  highIntentMatches: string[];
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

/**
 * Dialer funnel: calls placed → connected → converted, across three rolling
 * windows (today, 7d, 30d). Sourced from audit_log so we get historical
 * accuracy without touching live state.
 */
export async function fetchDialerFunnel(
  supabase: SupabaseClient,
): Promise<DialerFunnel> {
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);
  const since7 = new Date(now - 7 * 24 * 3600 * 1000);

  // Pull every relevant audit row in the last 30 days, then bucket in JS.
  const { data, error } = await supabase
    .from("audit_log")
    .select("action, created_at")
    .in("action", [
      "power_dialer.call_initiated",
      "power_dialer.connected",
      "power_dialer.cadence_step",
      "lead.converted_to_matter",
    ])
    .gte("created_at", since30)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error || !data) {
    const empty: DialerFunnelWindow = {
      callsPlaced: 0,
      connected: 0,
      matters: 0,
      noAnswers: 0,
    };
    return {
      today: empty,
      last7d: empty,
      last30d: empty,
      todayRates: {
        connectRate: null,
        convertRate: null,
        callToMatterRate: null,
      },
    };
  }

  const blank = (): DialerFunnelWindow => ({
    callsPlaced: 0,
    connected: 0,
    matters: 0,
    noAnswers: 0,
  });
  const today = blank();
  const last7d = blank();
  const last30d = blank();

  for (const row of data as Array<{ action: string; created_at: string }>) {
    const ts = new Date(row.created_at).getTime();
    const inToday = ts >= startOfTodayUtc.getTime();
    const in7d = ts >= since7.getTime();
    const bump = (w: DialerFunnelWindow) => {
      if (row.action === "power_dialer.call_initiated") w.callsPlaced++;
      else if (row.action === "power_dialer.connected") w.connected++;
      else if (row.action === "lead.converted_to_matter") w.matters++;
      else if (row.action === "power_dialer.cadence_step") w.noAnswers++;
    };
    bump(last30d);
    if (in7d) bump(last7d);
    if (inToday) bump(today);
  }

  function rate(n: number, d: number): number | null {
    return d === 0 ? null : Math.round((n / d) * 100);
  }

  return {
    today,
    last7d,
    last30d,
    todayRates: {
      connectRate: rate(today.connected, today.callsPlaced),
      convertRate: rate(today.matters, today.connected),
      callToMatterRate: rate(today.matters, today.callsPlaced),
    },
  };
}

// ---------------------------------------------------------------------------
// Fresh replies — fastest path to revenue is responding to inbound replies
// quickly. This pulls every pending message-approval that was triggered by
// an inbound reply (i.e. an AI draft sitting in the queue), enriches with
// what the prospect actually said, their lead score, and any high-intent
// keywords so Garrison can triage at a glance.
// ---------------------------------------------------------------------------

const HIGH_INTENT_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\byes\b/i, label: "yes" },
  { regex: /\binterested\b/i, label: "interested" },
  { regex: /\bready\b/i, label: "ready" },
  { regex: /\blet'?s? (?:do|start|go|get) (?:it|this|going|started)\b/i, label: "let's go" },
  { regex: /\bsend (?:it|me|the|over|that)\b/i, label: "send it" },
  { regex: /\bsign (?:me )?up\b/i, label: "sign me up" },
  { regex: /\bbook\b/i, label: "book" },
  { regex: /\bschedul/i, label: "schedule" },
  { regex: /\bcall me\b/i, label: "call me" },
  { regex: /\bwhat'?s (?:next|the next)/i, label: "what's next" },
  { regex: /\bhow do (?:i|we)\b/i, label: "how do I" },
  { regex: /\bwhen can\b/i, label: "when can" },
  { regex: /\bproceed\b/i, label: "proceed" },
];

function detectHighIntent(text: string | null): string[] {
  if (!text) return [];
  const matches: string[] = [];
  for (const { regex, label } of HIGH_INTENT_PATTERNS) {
    if (regex.test(text)) matches.push(label);
    if (matches.length >= 3) break;
  }
  return matches;
}

export async function fetchFreshReplies(
  supabase: SupabaseClient,
  limit = 8,
): Promise<FreshReply[]> {
  // 1) Pull pending message-type approvals, newest first.
  const { data: queueRows, error: qErr } = await supabase
    .from("approval_queue")
    .select("id, entity_id, action_type, metadata, created_at")
    .eq("status", "pending")
    .eq("entity_type", "message")
    .order("created_at", { ascending: false })
    .limit(limit * 3); // overfetch — some won't have matching inbound
  if (qErr || !queueRows) return [];
  if (queueRows.length === 0) return [];

  type QRow = {
    id: string;
    entity_id: string;
    action_type: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  };
  const rows = queueRows as QRow[];

  // 2) Pull the draft messages they point to (we need conversation_id +
  // body preview).
  const messageIds = rows.map((r) => r.entity_id);
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, conversation_id, content, channel")
    .in("id", messageIds);
  const msgById = new Map<
    string,
    { conversation_id: string; content: string | null; channel: string | null }
  >();
  for (const m of (msgs ?? []) as Array<{
    id: string;
    conversation_id: string;
    content: string | null;
    channel: string | null;
  }>) {
    msgById.set(m.id, m);
  }

  // 3) Pull the latest inbound message on each of those conversations.
  const conversationIds = Array.from(
    new Set(
      Array.from(msgById.values())
        .map((m) => m.conversation_id)
        .filter(Boolean),
    ),
  );
  const { data: inbound } = await supabase
    .from("messages")
    .select("conversation_id, content, channel, created_at")
    .in("conversation_id", conversationIds)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false });
  const latestInboundByConvo = new Map<
    string,
    { content: string; channel: string | null; created_at: string }
  >();
  for (const m of (inbound ?? []) as Array<{
    conversation_id: string;
    content: string | null;
    channel: string | null;
    created_at: string;
  }>) {
    if (latestInboundByConvo.has(m.conversation_id)) continue;
    if (!m.content) continue;
    latestInboundByConvo.set(m.conversation_id, {
      content: m.content,
      channel: m.channel,
      created_at: m.created_at,
    });
  }

  // 4) Pull conversations → lead_id → lead.payload.lead_score + contact.
  const { data: convoRows } = await supabase
    .from("conversations")
    .select("id, lead_id, contact_id")
    .in("id", conversationIds);
  type ConvoRow = {
    id: string;
    lead_id: string | null;
    contact_id: string | null;
  };
  const convoById = new Map<string, ConvoRow>();
  for (const c of (convoRows ?? []) as ConvoRow[]) {
    convoById.set(c.id, c);
  }

  const leadIds = Array.from(
    new Set(
      Array.from(convoById.values())
        .map((c) => c.lead_id)
        .filter((x): x is string => !!x),
    ),
  );
  const { data: leadRows } =
    leadIds.length > 0
      ? await supabase
          .from("leads")
          .select("id, full_name, payload, contacts:contact_id(full_name)")
          .in("id", leadIds)
      : { data: [] };
  type LeadRow = {
    id: string;
    full_name: string | null;
    payload: Record<string, unknown> | null;
    contacts: unknown;
  };
  const leadById = new Map<string, LeadRow>();
  for (const l of (leadRows ?? []) as LeadRow[]) {
    leadById.set(l.id, l);
  }

  // 5) Assemble + sort.
  const replies: FreshReply[] = [];
  for (const r of rows) {
    const msg = msgById.get(r.entity_id);
    if (!msg) continue;
    const convo = convoById.get(msg.conversation_id);
    const leadId = convo?.lead_id ?? null;
    const lead = leadId ? leadById.get(leadId) : null;
    const contact = lead
      ? ((Array.isArray(lead.contacts)
          ? lead.contacts[0]
          : lead.contacts) as { full_name?: string | null } | null)
      : null;
    const contactName =
      contact?.full_name ??
      (lead?.full_name as string | null) ??
      (r.metadata?.contact_name as string | undefined) ??
      "Unknown";
    const leadScore = lead?.payload?.lead_score as
      | { tier?: FreshReply["leadScoreTier"] }
      | undefined;
    const inboundHit = latestInboundByConvo.get(msg.conversation_id) ?? null;
    const matches = detectHighIntent(inboundHit?.content ?? null);
    const channel: "sms" | "email" =
      (msg.channel === "email" || msg.channel === "sms"
        ? msg.channel
        : (inboundHit?.channel === "email" ? "email" : "sms")) as
        | "sms"
        | "email";
    replies.push({
      approvalQueueId: r.id,
      messageId: r.entity_id,
      leadId,
      contactName,
      channel,
      inboundPreview: inboundHit
        ? inboundHit.content.length > 200
          ? inboundHit.content.slice(0, 200) + "…"
          : inboundHit.content
        : null,
      inboundAt: inboundHit?.created_at ?? null,
      draftPreview:
        (msg.content ?? "").length > 160
          ? (msg.content ?? "").slice(0, 160) + "…"
          : msg.content ?? "",
      approvalCreatedAt: r.created_at,
      leadScoreTier: leadScore?.tier ?? null,
      highIntent: matches.length > 0,
      highIntentMatches: matches,
    });
  }

  // Sort: high-intent first → hot/warm tier → recency.
  const tierWeight: Record<NonNullable<FreshReply["leadScoreTier"]>, number> = {
    hot: 4,
    warm: 3,
    unknown: 2,
    cool: 1,
    cold: 0,
  };
  replies.sort((a, b) => {
    if (a.highIntent !== b.highIntent) return a.highIntent ? -1 : 1;
    const at = a.leadScoreTier ? tierWeight[a.leadScoreTier] : 2;
    const bt = b.leadScoreTier ? tierWeight[b.leadScoreTier] : 2;
    if (at !== bt) return bt - at;
    return b.approvalCreatedAt.localeCompare(a.approvalCreatedAt);
  });

  return replies.slice(0, limit);
}
