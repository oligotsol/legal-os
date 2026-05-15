"use server";

/**
 * Mass-blast (text + email) server actions.
 *
 * Two entry points:
 *   - previewBlastRecipients: filter resolution + count + 5-row sample, used
 *     to render "X recipients will receive" + preview table in the compose
 *     sheet.
 *   - sendBlast: actually fires the messages. Sequential per-channel
 *     dispatch with concurrency cap + per-message error handling so one bad
 *     recipient doesn't blow up the batch.
 *
 * Architectural notes:
 *   - v0 stores blast metadata on messages.metadata.blast_id; no dedicated
 *     `blasts` table yet. Lift to typed tables when scheduled-send /
 *     campaign-followup / A/B-test land.
 *   - Hard cap of 200 recipients per blast — keeps us under Vercel's 300s
 *     function timeout (200 sends × ~700ms with concurrency ~= 30–40s).
 *   - Always excludes: DNC contacts, converted/dnc leads, soft-deleted rows.
 *   - Per CLAUDE.md §3 mass outreach SMS / email are not on the three hard
 *     approval gates (fee_quote / engagement_letter / invoice). Garrison
 *     reviewing + clicking Send IS the approval; we direct-dispatch.
 */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchMessage } from "@/lib/dispatch/outbound";
import { generateBlastDraft } from "@/lib/ai/generate-blast-draft";
import { normalizeE164 } from "@/lib/sms/phone";
import { assertSendWindow, checkSendWindow } from "@/lib/sms/send-window";
import { fetchOptedOutPhones } from "@/lib/sms/opt-outs";
import { logSmsSend } from "@/lib/sms/sends-log";
import {
  assertBodyHasMergeField,
  bodyHasMergeField,
} from "@/lib/sms/merge-fields";

const HARD_CAP = 200;
const SMS_CONCURRENCY = 2;
const EMAIL_CONCURRENCY = 4;

async function getActorInfo(): Promise<{ userId: string; firmId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) throw new Error("User does not belong to a firm");
  return { userId: user.id, firmId: membership.firm_id };
}

export type BlastChannel = "sms" | "email";

export interface BlastFilters {
  channel: BlastChannel;
  /** Lead source (e.g. "csv", "gmail"). undefined = any. */
  source?: string;
  /** CSV list_name on payload (e.g. "Firm Pilot"). undefined = any. */
  listName?: string;
  /** "new" / "contacted" / "any". Default: "any". Converted + dnc always excluded. */
  status?: "new" | "contacted" | "any";
  /** Minimum days since any inbound/outbound message on a lead's conversations.
   *  0 = no minimum (anyone). Useful: 3 (skip recently contacted). */
  minDaysSinceLastContact?: number;
}

export interface BlastRecipientPreview {
  leadId: string;
  contactId: string;
  fullName: string;
  identifier: string; // phone for SMS, email for email
  state: string | null;
  lastContactAt: string | null;
}

interface ResolvedRecipientList {
  recipients: BlastRecipientPreview[];
  totalMatching: number;
  cappedAt: number;
}

async function resolveRecipients(
  firmId: string,
  filters: BlastFilters,
): Promise<ResolvedRecipientList> {
  const admin = createAdminClient();

  let query = admin
    .from("leads")
    .select(
      "id, full_name, source, status, payload, contact_id, contacts:contact_id(id, full_name, phone, email, state, dnc)",
    )
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    // Never blast converted leads (they're already clients) or DNC leads.
    .in("status", filters.status === "any" || !filters.status
      ? ["new", "contacted"]
      : [filters.status]);

  if (filters.source) {
    query = query.eq("source", filters.source);
  }
  if (filters.listName) {
    query = query.contains("payload", { list_name: filters.listName });
  }

  const { data, error } = await query.limit(2000);
  if (error) throw new Error(`Recipient query failed: ${error.message}`);

  type Row = {
    id: string;
    full_name: string | null;
    source: string;
    status: string;
    payload: Record<string, unknown> | null;
    contact_id: string;
    contacts: unknown;
  };

  // Channel filter + dedupe.
  const raw = ((data ?? []) as Row[])
    .map((lead) => {
      const contact = (
        Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
      ) as
        | {
            id: string;
            full_name: string | null;
            phone: string | null;
            email: string | null;
            state: string | null;
            dnc: boolean;
          }
        | null;
      if (!contact) return null;
      if (contact.dnc) return null;
      const identifier =
        filters.channel === "sms" ? contact.phone : contact.email;
      if (!identifier) return null;
      return {
        leadId: lead.id,
        contactId: contact.id,
        fullName:
          contact.full_name ?? lead.full_name ?? identifier ?? "Unknown",
        identifier,
        state: contact.state,
        lastContactAt: null as string | null,
      };
    })
    .filter((r): r is BlastRecipientPreview => r !== null);

  // Compute last-contact-at for each lead via conversations.last_message_at.
  // Only needed when the filter is set OR when we want to show last-contact
  // in the preview. Single batched query.
  if (raw.length > 0) {
    const leadIds = raw.map((r) => r.leadId);
    const { data: convos } = await admin
      .from("conversations")
      .select("lead_id, last_message_at")
      .in("lead_id", leadIds);
    const latestByLead = new Map<string, string>();
    for (const c of (convos ?? []) as Array<{
      lead_id: string;
      last_message_at: string | null;
    }>) {
      if (!c.last_message_at) continue;
      const cur = latestByLead.get(c.lead_id);
      if (!cur || c.last_message_at > cur) {
        latestByLead.set(c.lead_id, c.last_message_at);
      }
    }
    for (const r of raw) {
      r.lastContactAt = latestByLead.get(r.leadId) ?? null;
    }
  }

  // Apply min-days-since-last-contact filter.
  const minDays = filters.minDaysSinceLastContact ?? 0;
  let filtered = raw;
  if (minDays > 0) {
    const cutoff = Date.now() - minDays * 24 * 60 * 60 * 1000;
    filtered = raw.filter((r) => {
      if (!r.lastContactAt) return true; // never contacted → include
      return new Date(r.lastContactAt).getTime() < cutoff;
    });
  }

  // Sort by createdAt-ish (we don't have it on the preview row, so use
  // lastContactAt; oldest-touched first feels right for re-engagement).
  filtered.sort((a, b) => {
    const aT = a.lastContactAt ? new Date(a.lastContactAt).getTime() : 0;
    const bT = b.lastContactAt ? new Date(b.lastContactAt).getTime() : 0;
    return aT - bT;
  });

  const totalMatching = filtered.length;
  const cappedAt = Math.min(totalMatching, HARD_CAP);
  const recipients = filtered.slice(0, cappedAt);

  return { recipients, totalMatching, cappedAt };
}

export interface PreviewBlastResult {
  totalMatching: number;
  cappedAt: number;
  hardCap: number;
  preview: BlastRecipientPreview[];
}

export async function previewBlastRecipients(
  filters: BlastFilters,
): Promise<PreviewBlastResult> {
  const { firmId } = await getActorInfo();
  const resolved = await resolveRecipients(firmId, filters);
  return {
    totalMatching: resolved.totalMatching,
    cappedAt: resolved.cappedAt,
    hardCap: HARD_CAP,
    preview: resolved.recipients.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Audience targets — the source × list_name combos available on this firm,
// each with a live count. Drives the "Target" dropdown in the compose sheet.
// ---------------------------------------------------------------------------

export interface BlastTarget {
  /** Stable key encoding source + listName, used as the dropdown <option> value. */
  key: string;
  /** Display label e.g. "CSV: Firm Pilot" or "Gmail (email intake)". */
  label: string;
  source: string;
  /** null when this target is the source-only bucket (no list_name). */
  listName: string | null;
  /** Live count of leads matching this target — pre-filter (channel, status,
   *  last-contact filters get applied later). */
  count: number;
}

const SOURCE_LABELS: Record<string, string> = {
  csv: "CSV",
  gmail: "Gmail (email intake)",
  dialpad: "Dialpad (SMS intake)",
  manual: "Manual",
};

export async function fetchBlastTargets(): Promise<BlastTarget[]> {
  const { firmId } = await getActorInfo();
  const admin = createAdminClient();

  // Pull a broad lead set + bucket in JS by (source, list_name).
  const { data, error } = await admin
    .from("leads")
    .select("source, payload, contacts:contact_id(dnc)")
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .in("status", ["new", "contacted"])
    .limit(5000);
  if (error) throw new Error(`Targets query failed: ${error.message}`);

  type Row = {
    source: string;
    payload: Record<string, unknown> | null;
    contacts: unknown;
  };

  const groups = new Map<string, BlastTarget>();
  for (const lead of (data ?? []) as Row[]) {
    const contact = (
      Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
    ) as { dnc?: boolean } | null;
    if (contact?.dnc) continue;
    const payload = (lead.payload ?? {}) as Record<string, unknown>;
    const listName = (payload.list_name as string | undefined) ?? null;
    const source = lead.source;
    const key = `${source}::${listName ?? "_"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    const sourceLabel = SOURCE_LABELS[source] ?? source;
    const label = listName ? `${sourceLabel}: ${listName}` : sourceLabel;
    groups.set(key, {
      key,
      label,
      source,
      listName,
      count: 1,
    });
  }

  // Sort: named lists first (alphabetical), then source-only buckets, then
  // by count descending within each tier. Garrison hits "Firm Pilot" the
  // most so named lists should be easiest to find.
  const targets = [...groups.values()];
  targets.sort((a, b) => {
    if (a.listName && !b.listName) return -1;
    if (!a.listName && b.listName) return 1;
    if (a.listName && b.listName) {
      const cmp = a.listName.localeCompare(b.listName);
      if (cmp !== 0) return cmp;
    }
    return b.count - a.count;
  });
  return targets;
}

// ---------------------------------------------------------------------------
// AI draft for the compose sheet
// ---------------------------------------------------------------------------

export interface DraftBlastInput {
  channel: BlastChannel;
  brief: string;
}

export interface DraftBlastResult {
  subject?: string;
  body: string;
  fellBack: boolean;
}

export async function draftBlastWithAi(
  input: DraftBlastInput,
): Promise<DraftBlastResult> {
  const { firmId } = await getActorInfo();
  if (!input.brief.trim()) {
    throw new Error("Brief cannot be empty");
  }
  const admin = createAdminClient();

  // Pull voice doctrine + attorney/firm naming from firm_config.
  const { data: rows } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", ["voice_doctrine", "attorney"]);
  const cfg: Record<string, Record<string, unknown>> = {};
  for (const r of rows ?? []) cfg[r.key] = (r.value ?? {}) as Record<string, unknown>;

  const voiceDoctrineRow = cfg.voice_doctrine ?? null;
  const voiceDoctrine =
    voiceDoctrineRow && voiceDoctrineRow.enabled !== false
      ? ((voiceDoctrineRow.content as string | undefined) ?? null)
      : null;

  const firmDisplayName =
    (cfg.attorney?.display_firm_name as string | undefined) ?? "the firm";
  const attorneyFirstName =
    (cfg.attorney?.first_name as string | undefined) ?? null;

  const result = await generateBlastDraft({
    channel: input.channel,
    brief: input.brief,
    voiceDoctrine,
    firmDisplayName,
    attorneyFirstName,
  });

  if (result.inputTokens > 0) {
    await admin.from("ai_jobs").insert({
      firm_id: firmId,
      model: result.model,
      purpose: "blast_draft",
      entity_type: null,
      entity_id: null,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: result.costCents,
      latency_ms: result.latencyMs,
      status: "completed",
      request_metadata: { channel: input.channel, fell_back: result.fellBack },
      privileged: false,
    });
  }

  return {
    subject: result.subject,
    body: result.body,
    fellBack: result.fellBack,
  };
}

// ---------------------------------------------------------------------------
// Token substitution: {first_name}, {state}, {firm_name}
// ---------------------------------------------------------------------------

function guessFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  if (/^[\d+]/.test(trimmed)) return "there"; // phone-as-name
  return trimmed.split(/\s+/)[0] || "there";
}

function applyTokens(
  template: string,
  vars: { firstName: string; state: string | null; firmName: string },
): string {
  return template
    .replace(/\{first_name\}/gi, vars.firstName)
    .replace(/\{state\}/gi, vars.state ?? "")
    .replace(/\{firm_name\}/gi, vars.firmName);
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Send blast
// ---------------------------------------------------------------------------

export interface SendBlastInput {
  filters: BlastFilters;
  body: string;
  /** Email only — required for channel='email'. */
  subject?: string;
  /** When true, no real sends fire. Returns personalized previews for every
   *  resolved recipient + counts of who would be skipped (opt-out / dnc).
   *  Writes a dry_run row per recipient to sms_sends for auditability. */
  dryRun?: boolean;
  /** When set, only send to the first N recipients of the resolved list.
   *  Use for staged rollouts ("send to first 3 real"). Ignored in dryRun. */
  testRecipientCount?: number;
}

export interface BlastPreviewRow {
  leadId: string;
  contactId: string;
  fullName: string;
  toIdentifier: string;
  toE164: string | null;
  body: string;
  subject?: string;
  /** Will this recipient be SENT, or SKIPPED, and why? Computed at preview
   *  time so the UI shows the truth before a real run. */
  resolution: "would_send" | "skipped_opt_out" | "skipped_dnc" | "skipped_no_identifier";
}

export interface SendBlastResult {
  blastId: string;
  attempted: number;
  sent: number;
  failed: number;
  skippedOptOut: number;
  capped: boolean;
  dryRun: boolean;
  testMode: boolean;
  /** Only populated when dryRun=true. */
  previews?: BlastPreviewRow[];
  errors: Array<{
    leadId: string;
    identifier: string;
    error: string;
    status?: string;
  }>;
}

export async function sendBlast(input: SendBlastInput): Promise<SendBlastResult> {
  const { firmId, userId } = await getActorInfo();
  const admin = createAdminClient();

  if (!input.body || input.body.trim().length === 0) {
    throw new Error("Body cannot be empty");
  }
  if (input.filters.channel === "email" && !input.subject?.trim()) {
    throw new Error("Email blasts require a subject line");
  }

  // Safety G: require at least one merge field so we never blast 200
  // identical texts. Skipped in dryRun=false-only because the preview path
  // is allowed to render unpersonalized text for the operator to fix.
  if (input.filters.channel === "sms" && !input.dryRun) {
    assertBodyHasMergeField(input.body);
  }

  // Safety A: send window guard for SMS only. Email blasts are not
  // time-of-day constrained the same way.
  if (input.filters.channel === "sms" && !input.dryRun) {
    assertSendWindow();
  }

  const resolved = await resolveRecipients(firmId, input.filters);
  if (resolved.recipients.length === 0) {
    throw new Error("No recipients matched the filters. Adjust + try again.");
  }

  // Look up the firm's "from" identifier for the channel.
  const fromKey =
    input.filters.channel === "sms"
      ? "dialpad_from_number"
      : "gmail_from_address";
  const { data: fromCfgRow } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", fromKey)
    .maybeSingle();
  const from =
    ((fromCfgRow?.value as Record<string, unknown> | null)?.value as
      | string
      | undefined) ?? "";
  if (!from) {
    throw new Error(
      `Firm has no ${input.filters.channel === "sms" ? "dialpad_from_number" : "gmail_from_address"} configured.`,
    );
  }

  // Firm display name for {firm_name} token substitution.
  const { data: attorneyCfgRow } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", "attorney")
    .maybeSingle();
  const firmName =
    (((attorneyCfgRow?.value ?? {}) as Record<string, unknown>)
      .display_firm_name as string | undefined) ?? "the firm";

  const blastId = randomUUID();
  const blastStartedAt = new Date().toISOString();
  const channel = input.filters.channel;
  const subject = input.subject?.trim() ?? null;
  const bodyTemplate = input.body;
  const dryRun = !!input.dryRun;
  const testMode =
    typeof input.testRecipientCount === "number" &&
    input.testRecipientCount > 0;

  // Safety D: pre-fetch the firm's phone-level opt-out set for SMS blasts
  // so we don't N+1 the table during the loop. Email blasts skip this.
  let optedOutSet: Set<string> = new Set();
  if (channel === "sms") {
    const phones = resolved.recipients.map((r) => r.identifier);
    optedOutSet = await fetchOptedOutPhones(admin, firmId, phones);
  }

  // Safety C: test-mode subset overrides the recipient list to the first N.
  // Applies to BOTH real sends and dry-runs (so you can preview the test
  // subset before firing it).
  const workingRecipients = testMode
    ? resolved.recipients.slice(0, input.testRecipientCount as number)
    : resolved.recipients;

  // Audit the blast as a single "started" event for traceability.
  try {
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: userId,
      p_action: dryRun ? "blast.dry_run_started" : "blast.started",
      p_entity_type: "blast",
      p_entity_id: blastId,
      p_before: null,
      p_after: {
        channel,
        recipient_count: workingRecipients.length,
        total_matching: resolved.totalMatching,
        capped: resolved.totalMatching > resolved.cappedAt,
        filters: input.filters,
        subject,
        body_length: bodyTemplate.length,
        dry_run: dryRun,
        test_mode: testMode,
        test_recipient_count: testMode ? input.testRecipientCount : null,
        opted_out_count: optedOutSet.size,
      },
      p_metadata: null,
    });
  } catch (err) {
    console.error("[blast] audit start failed:", err);
  }

  const errors: SendBlastResult["errors"] = [];
  const previews: BlastPreviewRow[] = [];
  let sent = 0;
  let failed = 0;
  let skippedOptOut = 0;

  const concurrency =
    channel === "sms" ? SMS_CONCURRENCY : EMAIL_CONCURRENCY;

  await runWithConcurrency(workingRecipients, concurrency, async (r) => {
    const personalizedBody = applyTokens(bodyTemplate, {
      firstName: guessFirstName(r.fullName),
      state: r.state,
      firmName,
    });
    const personalizedSubject =
      subject &&
      applyTokens(subject, {
        firstName: guessFirstName(r.fullName),
        state: r.state,
        firmName,
      });

    const toE164 =
      channel === "sms" ? normalizeE164(r.identifier) : null;

    // Safety D: opt-out check. SMS only.
    const isOptedOut =
      channel === "sms" && toE164 !== null && optedOutSet.has(toE164);

    // Dry-run path: record the preview, write a 'dry_run' sms_sends row
    // (for SMS only — email blasts don't use sms_sends), and return.
    if (dryRun) {
      const resolution: BlastPreviewRow["resolution"] = isOptedOut
        ? "skipped_opt_out"
        : channel === "sms" && !toE164
          ? "skipped_no_identifier"
          : "would_send";
      previews.push({
        leadId: r.leadId,
        contactId: r.contactId,
        fullName: r.fullName,
        toIdentifier: r.identifier,
        toE164,
        body: personalizedBody,
        subject: personalizedSubject ?? undefined,
        resolution,
      });
      if (resolution === "skipped_opt_out") skippedOptOut++;
      if (channel === "sms" && toE164) {
        await logSmsSend({
          admin,
          firmId,
          blastId,
          contactId: r.contactId,
          leadId: r.leadId,
          phoneE164: toE164,
          body: personalizedBody,
          status: isOptedOut ? "skipped_opt_out" : "dry_run",
          errorMessage: isOptedOut ? "phone in sms_opt_outs" : null,
        });
      }
      return;
    }

    // Safety D: live opt-out skip. Log to sms_sends + errors[] + return.
    if (isOptedOut && toE164) {
      skippedOptOut++;
      errors.push({
        leadId: r.leadId,
        identifier: r.identifier,
        error: "Phone is opted out (sms_opt_outs)",
        status: "skipped_opt_out",
      });
      await logSmsSend({
        admin,
        firmId,
        blastId,
        contactId: r.contactId,
        leadId: r.leadId,
        phoneE164: toE164,
        body: personalizedBody,
        status: "skipped_opt_out",
        errorMessage: "phone in sms_opt_outs",
      });
      return;
    }

    // Resolve / create the right conversation for this lead. Reuse an
    // existing active conversation on the channel; otherwise create one.
    let conversationId: string | null = null;
    const { data: existingConvo } = await admin
      .from("conversations")
      .select("id")
      .eq("firm_id", firmId)
      .eq("lead_id", r.leadId)
      .eq("channel", channel)
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingConvo) {
      conversationId = existingConvo.id;
    } else {
      const { data: created } = await admin
        .from("conversations")
        .insert({
          firm_id: firmId,
          lead_id: r.leadId,
          contact_id: r.contactId,
          status: "active",
          phase: "initial_contact",
          channel,
          message_count: 0,
        })
        .select("id")
        .single();
      conversationId = created?.id ?? null;
    }
    if (!conversationId) {
      failed++;
      errors.push({
        leadId: r.leadId,
        identifier: r.identifier,
        error: "Failed to resolve conversation",
      });
      if (channel === "sms" && toE164) {
        await logSmsSend({
          admin,
          firmId,
          blastId,
          contactId: r.contactId,
          leadId: r.leadId,
          phoneE164: toE164,
          body: personalizedBody,
          status: "failed",
          errorMessage: "Failed to resolve conversation",
        });
      }
      return;
    }

    // Insert the message row in "approved" state (already approved by the
    // attorney via Send). Dispatch will flip it to sent/failed.
    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .insert({
        firm_id: firmId,
        conversation_id: conversationId,
        direction: "outbound",
        channel,
        content: personalizedBody,
        sender_type: "attorney",
        sender_id: userId,
        ai_generated: false,
        status: "approved",
        metadata: {
          blast_id: blastId,
          blast_started_at: blastStartedAt,
          ...(personalizedSubject ? { subject: personalizedSubject } : {}),
          ...(testMode ? { test_mode: true } : {}),
        },
      })
      .select("id")
      .single();
    if (msgErr || !msg) {
      failed++;
      errors.push({
        leadId: r.leadId,
        identifier: r.identifier,
        error: msgErr?.message ?? "Failed to insert message",
      });
      if (channel === "sms" && toE164) {
        await logSmsSend({
          admin,
          firmId,
          blastId,
          contactId: r.contactId,
          leadId: r.leadId,
          phoneE164: toE164,
          body: personalizedBody,
          status: "failed",
          errorMessage: msgErr?.message ?? "Failed to insert message",
        });
      }
      return;
    }

    try {
      const result = await dispatchMessage(firmId, {
        channel,
        to: r.identifier,
        from,
        body: personalizedBody,
        subject: personalizedSubject ?? undefined,
        externalRef: msg.id,
      });

      const sentAt = new Date().toISOString();
      const externalId = result.result.messageId ?? null;
      await admin
        .from("messages")
        .update({
          status: "sent",
          external_id: externalId,
          sent_at: sentAt,
        })
        .eq("id", msg.id);
      await admin
        .from("conversations")
        .update({ last_message_at: sentAt })
        .eq("id", conversationId);
      sent++;

      // Safety E: TCPA log for every successful send.
      if (channel === "sms" && toE164) {
        await logSmsSend({
          admin,
          firmId,
          blastId,
          contactId: r.contactId,
          leadId: r.leadId,
          messageId: msg.id,
          phoneE164: toE164,
          body: personalizedBody,
          status: "sent",
          dialpadMessageId: externalId,
          sentAt,
        });
      }
    } catch (dispatchErr) {
      const errMsg =
        dispatchErr instanceof Error
          ? dispatchErr.message
          : String(dispatchErr);
      await admin
        .from("messages")
        .update({ status: "failed" })
        .eq("id", msg.id);
      failed++;
      errors.push({
        leadId: r.leadId,
        identifier: r.identifier,
        error: errMsg.slice(0, 500),
      });
      if (channel === "sms" && toE164) {
        await logSmsSend({
          admin,
          firmId,
          blastId,
          contactId: r.contactId,
          leadId: r.leadId,
          messageId: msg.id,
          phoneE164: toE164,
          body: personalizedBody,
          status: "failed",
          errorMessage: errMsg.slice(0, 500),
        });
      }
    }
  });

  // Final audit entry summarizing outcome.
  try {
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: userId,
      p_action: "blast.completed",
      p_entity_type: "blast",
      p_entity_id: blastId,
      p_before: null,
      p_after: {
        channel,
        attempted: resolved.recipients.length,
        sent,
        failed,
        capped: resolved.totalMatching > resolved.cappedAt,
      },
      p_metadata: null,
    });
  } catch (err) {
    console.error("[blast] audit complete failed:", err);
  }

  revalidatePath("/leads");
  revalidatePath("/conversations");

  return {
    blastId,
    attempted: resolved.recipients.length,
    sent,
    failed,
    capped: resolved.totalMatching > resolved.cappedAt,
    skippedOptOut,
    dryRun,
    testMode,
    errors: errors.slice(0, 20), // cap returned errors so we don't bloat the response
  };
}
