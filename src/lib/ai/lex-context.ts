/**
 * Lex system-prompt builder.
 *
 * Pulls firm-level voice (firm name, attorney name, tone, banned phrases)
 * from `firm_config` rather than hardcoding — CLAUDE.md non-negotiable #6
 * (no vertical-specific strings in core code).
 *
 * Page context lets Lex respond to whatever record the attorney is looking
 * at. The proxy attaches a *server-fetched* record (so we never trust
 * client-supplied data for the prompt body) — see route.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type LexPageKind =
  | "lead"
  | "conversation"
  | "approval"
  | "dashboard"
  | "pipeline"
  | "engagement"
  | "power_dialer"
  | "unknown";

export interface LexFirmVoice {
  firmName: string;
  attorneyName: string;
  tone: string;
  bannedPhrases: string[];
}

export interface LexPageContext {
  kind: LexPageKind;
  /** Optional structured record summary (firm-scoped, fetched by the proxy). */
  record?: Record<string, unknown> | null;
}

export interface LexFirmSummary {
  recentLeads: Array<{
    id: string;
    name: string;
    source: string | null;
    status: string | null;
    channel: string | null;
    state: string | null;
    matter: string | null;
    description: string | null;
    listName: string | null;
    createdAt: string;
    lastContactAt: string | null;
  }>;
  pendingApprovalsCount: number;
  recentApprovals: Array<{
    id: string;
    entityType: string;
    actionType: string | null;
    summary: string | null;
    createdAt: string;
  }>;
  recentConversations: Array<{
    id: string;
    contactName: string | null;
    channel: string | null;
    status: string;
    lastMessageAt: string | null;
    preview: string | null;
  }>;
}

export async function loadFirmVoice(
  supabase: SupabaseClient,
  firmId: string,
): Promise<LexFirmVoice> {
  const { data } = await supabase
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", ["negotiation_config", "conversation_config"]);

  const map = Object.fromEntries(
    (data ?? []).map((r) => [r.key, r.value as Record<string, unknown>]),
  );
  const neg = map.negotiation_config ?? {};
  const conv = map.conversation_config ?? {};

  return {
    firmName: (neg.firm_name as string) ?? "the firm",
    attorneyName: (neg.attorney_name as string) ?? "the attorney",
    tone: (neg.tone as string) ?? "Professional and warm",
    bannedPhrases: (conv.banned_phrases as string[]) ?? [],
  };
}

/**
 * Compose the system message attached to every Lex request. Kept tight: Lex
 * already has firm-level memory on her side; this just situates her in the
 * CRM session and hands over current-page context.
 */
export function buildLexSystemPrompt(
  voice: LexFirmVoice,
  context: LexPageContext,
  summary: LexFirmSummary | null = null,
): string {
  const banned =
    voice.bannedPhrases.length > 0
      ? `Avoid these phrases: ${voice.bannedPhrases.map((p) => `"${p}"`).join(", ")}.`
      : "";

  const base = [
    `You are Lex, AI Chief Operating Officer for ${voice.firmName} (attorney: ${voice.attorneyName}).`,
    `You are embedded in the Legal OS CRM. Be concise, precise, and use plain English.`,
    `Tone: ${voice.tone}.`,
    `Never use em dashes (—) or en dashes (–). Use commas, periods, or new sentences instead.`,
    banned,
    `All outputs are drafts for the attorney's review. Never treat anything as final work product.`,
    `CRITICAL: When asked about leads, approvals, or conversations, answer from the FIRM SNAPSHOT below. Do NOT say "no leads logged" if the snapshot has leads. Do NOT offer to add leads that already exist in the snapshot.`,
  ]
    .filter(Boolean)
    .join("\n");

  const sections: string[] = [base];
  if (summary) sections.push(renderFirmSummary(summary));
  const ctx = renderContext(context);
  if (ctx) sections.push(ctx);
  return sections.join("\n\n");
}

function renderFirmSummary(s: LexFirmSummary): string {
  const lines: string[] = ["FIRM SNAPSHOT (live data from the CRM, refreshed every turn):"];

  if (s.recentLeads.length === 0) {
    lines.push(`- No leads in the CRM yet.`);
  } else {
    lines.push(`Recent leads (${s.recentLeads.length}, newest first):`);
    for (const l of s.recentLeads) {
      const parts = [
        l.name,
        l.source ? `source=${l.source}` : null,
        l.status ? `status=${l.status}` : null,
        l.channel ? `channel=${l.channel}` : null,
        l.state ? `state=${l.state}` : null,
        l.matter ? `matter=${l.matter}` : null,
        l.listName ? `list=${l.listName}` : null,
        `created=${l.createdAt}`,
        l.lastContactAt ? `last_contact=${l.lastContactAt}` : null,
      ].filter(Boolean);
      lines.push(`  - [${l.id}] ${parts.join(" · ")}`);
      if (l.description) lines.push(`    description: ${l.description}`);
    }
  }

  lines.push(`Pending approvals: ${s.pendingApprovalsCount}`);
  if (s.recentApprovals.length > 0) {
    for (const a of s.recentApprovals) {
      lines.push(
        `  - [${a.id}] ${a.entityType}${a.actionType ? "/" + a.actionType : ""}${a.summary ? ": " + a.summary : ""}`,
      );
    }
  }

  if (s.recentConversations.length > 0) {
    lines.push("Recent conversations:");
    for (const c of s.recentConversations) {
      const head = `[${c.id}] ${c.contactName ?? "?"} · ${c.channel ?? "?"} · ${c.status}`;
      lines.push(`  - ${head}`);
      if (c.preview) lines.push(`    last: ${c.preview}`);
    }
  }

  return lines.join("\n");
}

export async function loadFirmSummary(
  supabase: SupabaseClient,
  firmId: string,
): Promise<LexFirmSummary> {
  const [leadsRes, approvalsCountRes, approvalsRecentRes, convosRes] =
    await Promise.all([
      supabase
        .from("leads")
        .select(
          "id, full_name, source, status, channel, payload, created_at, contacts:contact_id(full_name, state), conversations(last_message_at)",
        )
        .eq("firm_id", firmId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("approval_queue")
        .select("*", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .eq("status", "pending"),
      supabase
        .from("approval_queue")
        .select("id, entity_type, action_type, metadata, created_at")
        .eq("firm_id", firmId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("conversations")
        .select(
          "id, channel, status, last_message_at, contacts:contact_id(full_name)",
        )
        .eq("firm_id", firmId)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);

  const recentLeads = (leadsRes.data ?? []).map((l) => {
    const c = (
      Array.isArray(l.contacts) ? l.contacts[0] : l.contacts
    ) as { full_name?: string; state?: string } | null;
    const convs = (l.conversations ?? []) as Array<{
      last_message_at: string | null;
    }>;
    const lastContact =
      convs.reduce<string | null>((latest, c) => {
        if (!c.last_message_at) return latest;
        if (!latest) return c.last_message_at;
        return c.last_message_at > latest ? c.last_message_at : latest;
      }, null) ?? null;
    const p = (l.payload ?? {}) as Record<string, unknown>;
    return {
      id: l.id,
      name: l.full_name ?? c?.full_name ?? "Unknown",
      source: l.source ?? null,
      status: l.status ?? null,
      channel: l.channel ?? null,
      state: c?.state ?? null,
      matter: (p.matter_type as string | undefined) ?? null,
      description: (p.client_description as string | undefined) ?? null,
      listName: (p.list_name as string | undefined) ?? null,
      createdAt: l.created_at,
      lastContactAt: lastContact,
    };
  });

  const recentApprovals = (approvalsRecentRes.data ?? []).map((a) => {
    const m = (a.metadata ?? {}) as Record<string, unknown>;
    const summary =
      (m.contact_name as string | undefined) ??
      (m.summary as string | undefined) ??
      (m.text_preview as string | undefined) ??
      null;
    return {
      id: a.id,
      entityType: a.entity_type,
      actionType: (a.action_type as string | null) ?? null,
      summary,
      createdAt: a.created_at,
    };
  });

  const recentConversations = (convosRes.data ?? []).map((c) => {
    const ct = (
      Array.isArray(c.contacts) ? c.contacts[0] : c.contacts
    ) as { full_name?: string } | null;
    return {
      id: c.id,
      contactName: ct?.full_name ?? null,
      channel: c.channel ?? null,
      status: c.status,
      lastMessageAt: c.last_message_at,
      preview: null, // skipping message body fetch to keep summary small
    };
  });

  return {
    recentLeads,
    pendingApprovalsCount: approvalsCountRes.count ?? 0,
    recentApprovals,
    recentConversations,
  };
}

function renderContext(context: LexPageContext): string {
  if (context.kind === "unknown" || !context.record) return "";

  switch (context.kind) {
    case "lead":
      return renderLeadContext(context.record);
    case "conversation":
      return renderConversationContext(context.record);
    case "approval":
      return renderApprovalContext(context.record);
    case "pipeline":
      return `Current page: Pipeline overview.`;
    case "dashboard":
      return `Current page: Dashboard.`;
    case "power_dialer":
      return renderPowerDialerContext(context.record);
    case "engagement":
      return renderEngagementContext(context.record);
    default:
      return "";
  }
}

function fmt(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `- ${label}: ${String(value)}`;
}

function renderLeadContext(r: Record<string, unknown>): string {
  const lines = [
    "CURRENT LEAD:",
    fmt("Name", r.full_name ?? r.fullName),
    fmt("Source", r.source),
    fmt("List", r.list_name ?? (r.payload as { list_name?: string } | null)?.list_name),
    fmt("Status", r.status),
    fmt("Channel", r.channel),
    fmt("Email", r.email),
    fmt("Phone", r.phone),
    fmt("State", r.state),
    fmt("City", r.city),
    fmt("Matter", r.matter_type ?? r.matterType),
    fmt("Description", r.client_description ?? r.description),
  ].filter(Boolean);
  return lines.join("\n");
}

function renderConversationContext(r: Record<string, unknown>): string {
  const lines = [
    "CURRENT CONVERSATION:",
    fmt("Contact", r.contact_name ?? r.contactName),
    fmt("Channel", r.channel),
    fmt("Status", r.status),
    fmt("Phase", r.phase),
    fmt("Last message at", r.last_message_at ?? r.lastMessageAt),
    fmt("Messages", r.message_count ?? r.messageCount),
  ].filter(Boolean);
  return lines.join("\n");
}

function renderApprovalContext(r: Record<string, unknown>): string {
  return [
    "CURRENT APPROVAL ITEM:",
    fmt("Type", r.entity_type ?? r.entityType),
    fmt("Action", r.action_type ?? r.actionType),
    fmt("Priority", r.priority),
    fmt("Status", r.status),
  ]
    .filter(Boolean)
    .join("\n");
}

function renderPowerDialerContext(r: Record<string, unknown>): string {
  return [
    "POWER DIALER — ACTIVE LEAD:",
    fmt("Name", r.full_name ?? r.fullName),
    fmt("Phone", r.phone),
    fmt("State", r.state),
    fmt("Matter", r.matter_type ?? r.matterType),
    fmt("Description", r.client_description ?? r.description),
  ]
    .filter(Boolean)
    .join("\n");
}

function renderEngagementContext(r: Record<string, unknown>): string {
  return [
    "CURRENT ENGAGEMENT:",
    fmt("Client", r.client_name ?? r.clientName),
    fmt("Matter", r.matter_type ?? r.matterType),
    fmt("Status", r.status),
  ]
    .filter(Boolean)
    .join("\n");
}
