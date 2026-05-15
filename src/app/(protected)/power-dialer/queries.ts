import type { SupabaseClient } from "@supabase/supabase-js";
import {
  leadScoreSortWeight,
  type LeadScore,
  type LeadScoreTier,
} from "@/lib/ai/score-lead";

// ---------------------------------------------------------------------------
// Best-time-to-call scoring
// ---------------------------------------------------------------------------

/** Map common US timezone abbreviations to UTC hour offsets (standard, not
 *  DST — close enough for ranking purposes; we re-score every page load so
 *  drift across DST boundaries is bounded to <60 min off the ideal window). */
const TIMEZONE_OFFSETS: Record<string, number> = {
  ET: -5, EST: -5, EDT: -4, "America/New_York": -5,
  CT: -6, CST: -6, CDT: -5, "America/Chicago": -6,
  MT: -7, MST: -7, MDT: -6, "America/Denver": -7,
  PT: -8, PST: -8, PDT: -7, "America/Los_Angeles": -8,
  AT: -9, AKT: -9, "America/Anchorage": -9,
  HT: -10, HAT: -10, HST: -10, "Pacific/Honolulu": -10,
  AZ: -7, "America/Phoenix": -7,
};

function normalizeTimezone(tz: string | null | undefined): number | null {
  if (!tz) return null;
  const key = tz.trim();
  if (key in TIMEZONE_OFFSETS) return TIMEZONE_OFFSETS[key];
  const upper = key.toUpperCase();
  if (upper in TIMEZONE_OFFSETS) return TIMEZONE_OFFSETS[upper];
  return null;
}

/**
 * Score a lead's local hour-of-day for outbound calling. Higher = better
 * time to call.
 *   100 → 9-11am or 1-4pm local: prime answer window
 *    60 → 8am, noon, 5pm: shoulders of the window
 *    30 → 7am or 6pm: still daytime, lower hit rate
 *     0 → overnight / very early / very late
 *    50 → unknown timezone: don't penalize, sit neutrally in the middle
 */
function timeOfDayScore(timezone: string | null | undefined): {
  score: number;
  localHour: number | null;
} {
  const offset = normalizeTimezone(timezone);
  if (offset === null) return { score: 50, localHour: null };
  const utcHour = new Date().getUTCHours();
  let localHour = (utcHour + offset) % 24;
  if (localHour < 0) localHour += 24;

  let score: number;
  if ([9, 10, 11, 13, 14, 15, 16].includes(localHour)) score = 100;
  else if ([8, 12, 17].includes(localHour)) score = 60;
  else if ([7, 18].includes(localHour)) score = 30;
  else score = 0;
  return { score, localHour };
}

// Inline copy of looksLikeIntakeDump from src/lib/ai/generate-call-script.ts
// — kept here in case any caller still wants to label/render an intake-dump
// section specially. We no longer FILTER these out of the thread excerpt;
// per Garrison, LegalMatch Q/A answers ARE the message and need to be
// visible on the dialer card.
export function looksLikeIntakeDumpInline(text: string): boolean {
  if (!text) return false;
  return (
    text.includes("LEGALMATCH LEAD") ||
    text.includes("Parsed by Zapier") ||
    /^\s*New lead received/i.test(text) ||
    text.includes("CLIENT DESCRIPTION\n") ||
    text.includes("INTAKE ANSWERS")
  );
}

export type DialerStatus =
  | "active"
  | "skipped"
  | "on_hold"
  | "removed"
  | "converted";

export interface DialerQueueItem {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  /** From payload.timezone (e.g. "ET", "CT"). Lets the UI surface what time
   *  it is for the lead before Garrison calls. */
  timezone: string | null;
  matterType: string | null;
  clientDescription: string | null;
  source: string;
  /** CSV-import list name (e.g. "Firm Pilot"). Null for non-CSV sources. */
  listName: string | null;
  createdAt: string;
  /** Latest inbound message text — surfaced in the active card so Garrison
   *  knows why he's calling back. Null if the lead hasn't messaged.
   *  Kept for backwards compat with existing card layout; the new
   *  `recentMessages` field is the preferred surface. */
  latestInboundPreview: string | null;
  latestInboundAt: string | null;
  /** Last few messages on the lead's conversation (both directions, most
   *  recent first). Includes LegalMatch / Zapier intake dumps — per Garrison,
   *  those Q/A answers ARE the info he needs before the call. */
  recentMessages: Array<{
    direction: "inbound" | "outbound";
    content: string;
    channel: string | null;
    createdAt: string;
    isIntakeDump: boolean;
  }>;
  /** Pre-generated 2-3 sentence at-a-glance brief, persisted on
   *  payload.dialer.background_brief. Null until the backfill runs. */
  backgroundBrief: string | null;
  /** Pre-generated structured call script (opening/situation/asks/close).
   *  Null while the backfill hasn't reached this lead — the UI falls back
   *  to a tiny inline template using firm config. */
  script: {
    opening: string;
    situation: string[];
    asks: string[];
    close: string;
  } | null;
  /** Per-lead dialer-state surface so the right-rail can show subtle badges. */
  dialerStatus: DialerStatus;
  dialerAttempts: number;
  dialerLastOutcome: string | null;
  dialerSkippedAt: string | null;
  /** Pre-computed lead-quality classification (hot/warm/cool/cold/unknown) +
   *  one-sentence reasoning + concrete urgency signals. Null when no score
   *  has been generated yet (older leads pre-dating the scorer). */
  leadScore: LeadScore | null;
  /** Best-time-to-call score for THIS load. Recomputed every page render
   *  so the queue floats leads into prime hours as the day moves. */
  timeOfDayScore: number;
  /** Lead's local hour of day at time of this load (0-23), or null if we
   *  don't know their timezone. Surfaced as a small chip on the card. */
  localHour: number | null;
}

export interface DialerQueueFilter {
  /** Filter by source (csv / dialpad / gmail / etc.). */
  source?: string;
  /** Filter by CSV list name (e.g. "Firm Pilot"). */
  listName?: string;
}

export interface DialerSourceBreakdown {
  /** Source + (optional) listName tuple, with active dial-ready count. */
  key: string;
  label: string;
  source: string;
  listName: string | null;
  count: number;
}

/**
 * Returns leads that are dial-ready: phone present, not DNC, not removed
 * from the dialer queue, and not currently on hold.
 *
 * Sort order: never-skipped first (newest lead first), then skipped leads
 * at the tail (oldest skip first so they cycle back fastest).
 *
 * State filtering happens in JS rather than SQL — PostgREST's JSON-path
 * `nullsFirst` ordering is fiddly and the queue stays small (200 raw rows,
 * sliced to 50). When the queue grows past that, extract `dialer` into a
 * typed `dialer_queue` table.
 */
export async function fetchDialerQueue(
  supabase: SupabaseClient,
  filter?: DialerQueueFilter,
): Promise<DialerQueueItem[]> {
  let query = supabase
    .from("leads")
    .select(
      "id, full_name, phone, email, status, source, payload, created_at, contacts:contact_id(full_name, phone, email, state, dnc)",
    )
    .is("deleted_at", null)
    .eq("status", "new")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (filter?.source) {
    query = query.eq("source", filter.source);
  }
  if (filter?.listName) {
    query = query.contains("payload", { list_name: filter.listName });
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch dialer queue: ${error.message}`);
  }

  const now = Date.now();

  type Row = {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    source: string;
    payload: Record<string, unknown> | null;
    created_at: string;
    contacts: unknown;
  };

  const candidates = ((data ?? []) as Row[])
    .map((lead): DialerQueueItem | null => {
      const contact = (
        Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
      ) as
        | {
            full_name: string;
            phone: string | null;
            email: string | null;
            state: string | null;
            dnc: boolean;
          }
        | null;

      if (contact?.dnc) return null;
      const phone = contact?.phone ?? lead.phone ?? null;
      if (!phone) return null;

      const payload = (lead.payload ?? {}) as Record<string, unknown>;
      const dialer =
        (payload.dialer as
          | {
              status?: DialerStatus;
              attempts?: number;
              last_outcome?: string | null;
              skipped_at?: string | null;
              on_hold_until?: string | null;
            }
          | undefined) ?? {};

      // Filter out removed + converted + active holds.
      if (dialer.status === "removed" || dialer.status === "converted") return null;
      if (
        dialer.status === "on_hold" &&
        typeof dialer.on_hold_until === "string"
      ) {
        const until = new Date(dialer.on_hold_until).getTime();
        if (!Number.isNaN(until) && until > now) return null;
      }

      const dialerExt = dialer as unknown as {
        script?: { opening: string; situation: string[]; asks: string[]; close: string };
        background_brief?: string;
      };
      const dialerScript = dialerExt.script;
      const timezone = (payload.timezone as string | undefined) ?? null;
      const tod = timeOfDayScore(timezone);
      // Validate the stored lead_score shape; if malformed, treat as null.
      const rawScore = payload.lead_score as
        | (LeadScore & { generated_at?: string; model?: string })
        | undefined
        | null;
      const leadScore: LeadScore | null =
        rawScore && typeof rawScore.tier === "string"
          ? {
              tier: rawScore.tier as LeadScoreTier,
              score: typeof rawScore.score === "number" ? rawScore.score : 0,
              reasoning: typeof rawScore.reasoning === "string" ? rawScore.reasoning : "",
              urgency_signals: Array.isArray(rawScore.urgency_signals)
                ? (rawScore.urgency_signals as string[])
                : [],
              missing_info: Array.isArray(rawScore.missing_info)
                ? (rawScore.missing_info as string[])
                : [],
            }
          : null;
      return {
        id: lead.id,
        fullName: contact?.full_name ?? lead.full_name ?? "Unknown",
        phone,
        email: contact?.email ?? lead.email ?? null,
        state: contact?.state ?? null,
        timezone,
        matterType: (payload.matter_type as string | undefined) ?? null,
        clientDescription:
          (payload.description_summary as string | undefined) ??
          (payload.client_description as string | undefined) ??
          null,
        source: lead.source,
        listName: (payload.list_name as string | undefined) ?? null,
        createdAt: lead.created_at,
        latestInboundPreview: null,
        latestInboundAt: null,
        recentMessages: [],
        backgroundBrief:
          typeof dialerExt.background_brief === "string" &&
          dialerExt.background_brief.trim().length > 0
            ? dialerExt.background_brief
            : null,
        script:
          dialerScript &&
          typeof dialerScript.opening === "string" &&
          Array.isArray(dialerScript.asks)
            ? dialerScript
            : null,
        dialerStatus: dialer.status ?? "active",
        dialerAttempts: dialer.attempts ?? 0,
        dialerLastOutcome: dialer.last_outcome ?? null,
        dialerSkippedAt: dialer.skipped_at ?? null,
        leadScore,
        timeOfDayScore: tod.score,
        localHour: tod.localHour,
      };
    })
    .filter((x): x is DialerQueueItem => x !== null);

  // Decorate with recent thread excerpts per lead — single batch query so we
  // don't N+1 against the messages table. We pull BOTH directions (inbound +
  // outbound) and include LegalMatch / Zapier intake dumps so Garrison sees
  // the prospect's actual Q/A answers on the dialer card. Cap at the latest
  // 3 messages per lead to keep the card compact.
  const trimmed = candidates.slice(0, 200);
  if (trimmed.length > 0) {
    const leadIds = trimmed.map((l) => l.id);
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, lead_id")
      .in("lead_id", leadIds);
    const convToLead = new Map<string, string>();
    for (const c of (convs ?? []) as Array<{ id: string; lead_id: string }>) {
      convToLead.set(c.id, c.lead_id);
    }
    if (convToLead.size > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id, content, created_at, direction, channel, status")
        .in("conversation_id", [...convToLead.keys()])
        .order("created_at", { ascending: false });

      const messagesByLead = new Map<
        string,
        Array<{
          direction: "inbound" | "outbound";
          content: string;
          channel: string | null;
          createdAt: string;
          isIntakeDump: boolean;
        }>
      >();
      const latestInboundByLead = new Map<string, { content: string; at: string }>();
      // Only count outbound rows that actually went out the door. AI drafts
      // sitting in pending_approval / approved-but-not-dispatched / failed /
      // rejected must NOT show up as "we sent" — that's a lie to Garrison.
      const SENT_OUTBOUND_STATUSES = new Set(["sent", "delivered"]);
      for (const m of (msgs ?? []) as Array<{
        conversation_id: string;
        content: string | null;
        created_at: string;
        direction: string | null;
        channel: string | null;
        status: string | null;
      }>) {
        const lid = convToLead.get(m.conversation_id);
        if (!lid || !m.content) continue;
        const direction =
          m.direction === "outbound" ? "outbound" : "inbound";
        if (direction === "outbound" && !SENT_OUTBOUND_STATUSES.has(m.status ?? "")) {
          continue;
        }
        const isIntakeDump = looksLikeIntakeDumpInline(m.content);
        const arr = messagesByLead.get(lid) ?? [];
        if (arr.length < 3) {
          arr.push({
            direction,
            content: m.content,
            channel: m.channel,
            createdAt: m.created_at,
            isIntakeDump,
          });
          messagesByLead.set(lid, arr);
        }
        // Latest inbound (non-intake) preview — kept for backwards compat.
        if (
          direction === "inbound" &&
          !isIntakeDump &&
          !latestInboundByLead.has(lid)
        ) {
          latestInboundByLead.set(lid, {
            content: m.content,
            at: m.created_at,
          });
        }
      }
      for (const lead of trimmed) {
        const arr = messagesByLead.get(lead.id);
        if (arr && arr.length > 0) {
          lead.recentMessages = arr;
        }
        const inboundHit = latestInboundByLead.get(lead.id);
        if (inboundHit) {
          lead.latestInboundPreview =
            inboundHit.content.length > 400
              ? inboundHit.content.slice(0, 400).trimEnd() + "…"
              : inboundHit.content;
          lead.latestInboundAt = inboundHit.at;
        }
      }
    }
  }

  // Sort logic (descending = call first):
  //   1. Skipped leads always go to the bottom (cycled back later).
  //   2. Time-of-day BUCKET (prime / shoulder / off-hours) — calling at the
  //      right local hour is a hard constraint on connect rate, so this
  //      dominates lead-score ordering.
  //   3. Lead-score tier + sub-score — hot before warm before cool, with
  //      unknown sitting neutrally between cool and warm so unscored leads
  //      aren't penalized but also aren't artificially boosted.
  //   4. Recency (newest first) as the tiebreaker so freshly-arrived leads
  //      surface promptly within their tier.
  function todBucket(score: number): number {
    if (score >= 100) return 3; // prime
    if (score >= 60) return 2; // shoulder
    if (score >= 30) return 1; // edge
    if (score >= 50) return 2; // unknown-tz (50) sits in shoulder
    return 0; // off-hours
  }
  candidates.sort((a, b) => {
    const aSkipped = !!a.dialerSkippedAt;
    const bSkipped = !!b.dialerSkippedAt;
    if (aSkipped !== bSkipped) return aSkipped ? 1 : -1;
    if (aSkipped) {
      // Both skipped — oldest skip cycles back first.
      return (a.dialerSkippedAt ?? "").localeCompare(b.dialerSkippedAt ?? "");
    }
    const aBucket = todBucket(a.timeOfDayScore);
    const bBucket = todBucket(b.timeOfDayScore);
    if (aBucket !== bBucket) return bBucket - aBucket;
    const aLead = leadScoreSortWeight(a.leadScore);
    const bLead = leadScoreSortWeight(b.leadScore);
    if (aLead !== bLead) return bLead - aLead;
    return b.createdAt.localeCompare(a.createdAt);
  });

  // 200 active leads is plenty for a single dialing session. The full
  // ~1,100-lead pool stays in the DB; Garrison gets fresh batches as he
  // works through these via Skip / Hold / Remove / Connected.
  return trimmed;
}

/**
 * Returns a roster of source/list groupings with their active dial-ready
 * counts, so the filter chips in the UI show "Firm Pilot (554)" etc.
 */
export async function fetchDialerSourceBreakdown(
  supabase: SupabaseClient,
): Promise<DialerSourceBreakdown[]> {
  // Pull just the columns we need, broadly. Filter / count in JS so the
  // dialer-state filter logic stays in one place (fetchDialerQueue applies
  // the same rules).
  const { data } = await supabase
    .from("leads")
    .select("source, payload, contacts:contact_id(dnc, phone)")
    .is("deleted_at", null)
    .eq("status", "new")
    .limit(2000);

  const now = Date.now();
  const groups = new Map<string, DialerSourceBreakdown>();
  for (const lead of (data ?? []) as Array<{
    source: string;
    payload: Record<string, unknown> | null;
    contacts: unknown;
  }>) {
    const c = (
      Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
    ) as { dnc?: boolean; phone?: string } | null;
    if (c?.dnc || !c?.phone) continue;
    const p = (lead.payload ?? {}) as Record<string, unknown>;
    const dialer = (p.dialer ?? {}) as {
      status?: string;
      on_hold_until?: string;
    };
    if (dialer.status === "removed" || dialer.status === "converted") continue;
    if (
      dialer.status === "on_hold" &&
      typeof dialer.on_hold_until === "string"
    ) {
      const until = new Date(dialer.on_hold_until).getTime();
      if (!Number.isNaN(until) && until > now) continue;
    }
    const listName = (p.list_name as string | undefined) ?? null;
    const key = `${lead.source}::${listName ?? "_"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      const label = listName ?? lead.source;
      groups.set(key, {
        key,
        label,
        source: lead.source,
        listName,
        count: 1,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Firm-config loader for the dialer page
// ---------------------------------------------------------------------------

export interface DialerFirmConfig {
  voicemailScript: string;
  /** Template for the call script. Supports `{first_name}`, `{full_name}`,
   *  `{attorney_first_name}`, `{firm_display_name}`, `{matter}`, `{state}`,
   *  `{list_name}` placeholders — substituted at render time per-lead. */
  callScript: string;
  attorneyFirstName: string;
  firmDisplayName: string;
  holdDaysDefault: number;
}

const DEFAULT_VOICEMAIL_SCRIPT =
  "Hi, this is the legal team calling regarding your matter. Please let us know when a good time to chat would be. Looking forward to assisting you.";

const DEFAULT_CALL_SCRIPT =
  "Hi, is this {first_name}?\n\nThis is {attorney_first_name} with {firm_display_name}. I'm reaching out about your legal matter. Do you have a few minutes to chat?";

export async function fetchDialerFirmConfig(
  supabase: SupabaseClient,
): Promise<DialerFirmConfig> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      voicemailScript: DEFAULT_VOICEMAIL_SCRIPT,
      callScript: DEFAULT_CALL_SCRIPT,
      attorneyFirstName: "the attorney",
      firmDisplayName: "the firm",
      holdDaysDefault: 3,
    };
  }

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) {
    return {
      voicemailScript: DEFAULT_VOICEMAIL_SCRIPT,
      callScript: DEFAULT_CALL_SCRIPT,
      attorneyFirstName: "the attorney",
      firmDisplayName: "the firm",
      holdDaysDefault: 3,
    };
  }

  const { data: rows } = await supabase
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", membership.firm_id)
    .in("key", ["attorney", "power_dialer"]);

  const cfg: Record<string, Record<string, unknown>> = {};
  for (const r of rows ?? []) {
    cfg[r.key] = (r.value as Record<string, unknown>) ?? {};
  }

  return {
    voicemailScript:
      (cfg.power_dialer?.voicemail_script as string | undefined) ??
      DEFAULT_VOICEMAIL_SCRIPT,
    callScript:
      (cfg.power_dialer?.call_script as string | undefined) ?? DEFAULT_CALL_SCRIPT,
    attorneyFirstName:
      (cfg.attorney?.first_name as string | undefined) ?? "the attorney",
    firmDisplayName:
      (cfg.attorney?.display_firm_name as string | undefined) ?? "the firm",
    holdDaysDefault:
      (cfg.power_dialer?.hold_days_default as number | undefined) ?? 3,
  };
}

/**
 * Substitute placeholders in a script template using the lead + firm config.
 * Unknown placeholders are left intact; we don't want to silently delete
 * "{matter}" when the lead has no matter on file — render shows it so the
 * attorney knows to mention it (or skip it) in their own words.
 */
export function fillScriptTemplate(
  template: string,
  vars: {
    firstName?: string | null;
    fullName?: string | null;
    attorneyFirstName?: string | null;
    firmDisplayName?: string | null;
    matter?: string | null;
    state?: string | null;
    listName?: string | null;
  },
): string {
  return template
    .replace(/\{first_name\}/g, vars.firstName ?? "there")
    .replace(/\{full_name\}/g, vars.fullName ?? "there")
    .replace(
      /\{attorney_first_name\}/g,
      vars.attorneyFirstName ?? "the attorney",
    )
    .replace(/\{firm_display_name\}/g, vars.firmDisplayName ?? "the firm")
    .replace(/\{matter\}/g, vars.matter ?? "your matter")
    .replace(/\{state\}/g, vars.state ?? "")
    .replace(/\{list_name\}/g, vars.listName ?? "");
}
