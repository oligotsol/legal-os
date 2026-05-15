"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchMessage } from "@/lib/dispatch/outbound";
import { generateDialerSms } from "@/lib/ai/generate-dialer-sms";
import { convertLeadToMatter } from "@/lib/pipeline/convert-lead";
import { runDialerCadenceStep } from "@/lib/pipeline/dialer-cadence";
import {
  cancelPostConnectedFollowups,
  schedulePostConnectedFollowup,
} from "@/lib/pipeline/schedule-post-connected-followup";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ActorFirm {
  userId: string;
  firmId: string;
}

async function resolveFirm(): Promise<ActorFirm> {
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

type DialerState = {
  status?: "active" | "skipped" | "on_hold" | "removed" | "converted";
  attempts?: number;
  last_outcome?: DialerOutcome | null;
  last_call_at?: string | null;
  last_call_id?: string | null;
  skipped_at?: string | null;
  on_hold_until?: string | null;
  needs_voicemail?: boolean;
  history?: Array<{
    at: string;
    outcome: DialerOutcome;
    sms_message_id?: string | null;
    call_id?: string | null;
  }>;
};

function mergeDialer(payload: Record<string, unknown> | null, patch: DialerState): Record<string, unknown> {
  const base = (payload ?? {}) as Record<string, unknown>;
  const dialerBase = (base.dialer as DialerState | undefined) ?? {};
  const history = [...(dialerBase.history ?? []), ...(patch.history ?? [])].slice(-20);
  const merged: DialerState = {
    ...dialerBase,
    ...patch,
    history: history.length > 0 ? history : undefined,
  };
  return { ...base, dialer: merged };
}

async function auditDialer(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  userId: string,
  action: string,
  leadId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: userId,
      p_action: action,
      p_entity_type: "lead",
      p_entity_id: leadId,
      p_before: before,
      p_after: after,
      p_metadata: { source: "power_dialer", ...meta },
    });
  } catch (err) {
    console.error("[power_dialer] audit insert failed:", err);
  }
}

// ---------------------------------------------------------------------------
// startDialerCall — initiate the call AND persist call_id on the lead so the
// Dialpad call-end webhook can find it later and auto-run the cadence.
// ---------------------------------------------------------------------------

export async function startDialerCall(
  leadId: string,
): Promise<{ callId: string | null; phone: string }> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload, contact_id, contacts:contact_id(phone)")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const contact = (
    Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
  ) as { phone: string | null } | null;
  const phone = contact?.phone ?? null;
  if (!phone) throw new Error("Lead has no phone number");

  const { callId } = await initiateDialpadCall(phone);

  // Persist the call_id so the webhook can map call-end → lead.
  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const beforeDialer = (payload.dialer ?? {}) as DialerState;
  const now = new Date().toISOString();
  const newPayload = mergeDialer(payload, {
    status: "active",
    last_call_id: callId,
    last_call_at: now,
    history: [
      {
        at: now,
        outcome: "call_initiated" as DialerOutcome,
        call_id: callId,
      },
    ],
  });
  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.call_initiated",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
    { call_id: callId, phone },
  );

  return { callId, phone };
}

// ---------------------------------------------------------------------------
// markLeadConverted — Garrison got on the call. Records outcome, leaves lead
// in CRM (status stays "new" for the standard lead flow downstream; the
// dialer marks it as "converted" so it stops appearing in the queue).
// ---------------------------------------------------------------------------

export async function markLeadConverted(leadId: string): Promise<{ ok: true }> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const beforeDialer = ((lead.payload as Record<string, unknown> | null)?.dialer ??
    {}) as DialerState;
  const newPayload = mergeDialer(lead.payload as Record<string, unknown> | null, {
    status: "converted",
    last_outcome: "connected",
    history: [
      {
        at: new Date().toISOString(),
        outcome: "connected" as DialerOutcome,
      },
    ],
  });
  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.connected",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// markVoicemailLeft — Garrison just read the VM script after the beep.
// Clears the needs_voicemail flag and records the outcome.
// ---------------------------------------------------------------------------

export async function markVoicemailLeft(leadId: string): Promise<{ ok: true }> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const beforeDialer = ((lead.payload as Record<string, unknown> | null)?.dialer ??
    {}) as DialerState;
  const newPayload = mergeDialer(lead.payload as Record<string, unknown> | null, {
    last_outcome: "voicemail_left",
    history: [
      {
        at: new Date().toISOString(),
        outcome: "voicemail_left" as DialerOutcome,
      },
    ],
  });
  // Clear the needs_voicemail signal so the client moves on.
  const dialerObj = newPayload.dialer as Record<string, unknown>;
  delete dialerObj.needs_voicemail;
  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.voicemail_left",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// pollDialerLeadState — light read for the client to detect cadence progress
// driven by the Dialpad webhook (attempts incrementing, needs_voicemail flag,
// SMS sent, etc.).
// ---------------------------------------------------------------------------

export async function pollDialerLeadState(leadId: string): Promise<{
  attempts: number;
  status: string | null;
  lastOutcome: string | null;
  needsVoicemail: boolean;
  lastCallId: string | null;
  lastCallAt: string | null;
  historyLen: number;
}> {
  const { firmId } = await resolveFirm();
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) {
    return {
      attempts: 0,
      status: null,
      lastOutcome: null,
      needsVoicemail: false,
      lastCallId: null,
      lastCallAt: null,
      historyLen: 0,
    };
  }
  const d = ((lead.payload as Record<string, unknown> | null)?.dialer ?? {}) as DialerState;
  return {
    attempts: d.attempts ?? 0,
    status: d.status ?? null,
    lastOutcome: d.last_outcome ?? null,
    needsVoicemail: !!(d as { needs_voicemail?: boolean }).needs_voicemail,
    lastCallId: d.last_call_id ?? null,
    lastCallAt: d.last_call_at ?? null,
    historyLen: (d.history ?? []).length,
  };
}

// ---------------------------------------------------------------------------
// initiateDialpadCall — unchanged
// ---------------------------------------------------------------------------

export async function initiateDialpadCall(toPhone: string): Promise<{
  callId: string | null;
}> {
  const { firmId } = await resolveFirm();

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("credentials, status")
    .eq("firm_id", firmId)
    .eq("provider", "dialpad")
    .maybeSingle();

  if (!integration) {
    throw new Error("Dialpad integration is not set up for this firm.");
  }
  if (integration.status !== "active") {
    throw new Error(
      `Dialpad integration is "${integration.status}" — reactivate to dial.`,
    );
  }

  const creds = integration.credentials as {
    apiKey?: string;
    userId?: string | number;
  } | null;
  if (!creds?.apiKey) {
    throw new Error("Dialpad credentials are missing an apiKey.");
  }
  if (!creds.userId) {
    throw new Error(
      "Dialpad credentials are missing userId — set firm_config or integration_accounts.credentials.userId.",
    );
  }

  const baseUrl =
    process.env.DIALPAD_API_BASE_URL ?? "https://dialpad.com/api/v2";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        user_id: creds.userId,
        phone_number: toPhone,
      }),
    });
  } catch (err) {
    throw new Error(
      `Network error calling Dialpad: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Dialpad ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const callId =
    (typeof json.id === "string" && json.id) ||
    (typeof json.call_id === "string" && json.call_id) ||
    null;

  return { callId };
}

// ---------------------------------------------------------------------------
// recordOutcomeAndSendSms
// ---------------------------------------------------------------------------

export type DialerOutcome =
  | "no_answer_1"
  | "no_answer_2"
  | "connected"
  | "voicemail_left"
  | "call_initiated";

export interface RecordOutcomeResult {
  smsSent: boolean;
  messageId?: string;
  smsBody?: string;
  attempts: number;
}

/**
 * Record a call outcome and (when outcome is "no_answer_1") auto-send the
 * follow-up SMS in one server round-trip.
 *
 * AUTO-SEND COMPLIANCE NOTE: CLAUDE.md §3 hard-codes approval for fee_quote /
 * engagement_letter / invoice. Outreach SMS is not one of those gates, so we
 * deliberately bypass approval_queue for this surface. Firms can opt back
 * into review by setting firm_config.approval_mode.power_dialer_sms =
 * "always_review" (not yet wired in v1).
 */
export async function recordOutcomeAndSendSms(
  leadId: string,
  outcome: DialerOutcome,
  callIdHint?: string | null,
): Promise<RecordOutcomeResult> {
  if (
    outcome !== "no_answer_1" &&
    outcome !== "no_answer_2" &&
    outcome !== "connected" &&
    outcome !== "voicemail_left"
  ) {
    throw new Error(`Unknown outcome: ${outcome}`);
  }

  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select(
      "id, payload, contact_id, contacts:contact_id(full_name, phone, email, state)",
    )
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const contact = (
    Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
  ) as {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    state: string | null;
  } | null;

  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const beforeDialer = ((payload.dialer ?? {}) as DialerState) ?? {};
  const currentAttempts = beforeDialer.attempts ?? 0;
  const nextAttempts =
    outcome === "no_answer_1" || outcome === "no_answer_2"
      ? currentAttempts + 1
      : currentAttempts;

  const now = new Date().toISOString();

  // --- SMS auto-send on first no-answer ---
  let smsResult: { messageId?: string; smsBody?: string; sent: boolean } = {
    sent: false,
  };

  if (outcome === "no_answer_1" && contact?.phone) {
    smsResult = await autoSendNoAnswerSms({
      admin,
      firmId,
      userId,
      leadId,
      contact,
      payload,
    });
  }

  // --- Persist dialer state ---
  const historyEntry = {
    at: now,
    outcome,
    sms_message_id: smsResult.messageId ?? null,
    call_id: callIdHint ?? null,
  };

  const newPayload = mergeDialer(payload, {
    status: "active",
    attempts: nextAttempts,
    last_outcome: outcome,
    last_call_at: now,
    last_call_id: callIdHint ?? null,
    history: [historyEntry],
  });

  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.outcome_recorded",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
    { outcome, sms_sent: smsResult.sent },
  );

  return {
    smsSent: smsResult.sent,
    messageId: smsResult.messageId,
    smsBody: smsResult.smsBody,
    attempts: nextAttempts,
  };
}

async function autoSendNoAnswerSms(args: {
  admin: ReturnType<typeof createAdminClient>;
  firmId: string;
  userId: string;
  leadId: string;
  contact: {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    state: string | null;
  };
  payload: Record<string, unknown>;
}): Promise<{ sent: boolean; messageId?: string; smsBody?: string }> {
  const { admin, firmId, userId, leadId, contact, payload } = args;
  if (!contact.phone) return { sent: false };

  // Firm config — vertical-generic. Falls back to safe defaults so a new
  // tenant without seeded config still gets *something* coherent (per
  // CLAUDE.md #7, ideally onboarding seeds these explicitly).
  const { data: configRows } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", ["attorney", "power_dialer", "dialpad_from_number"]);
  const cfg: Record<string, Record<string, unknown>> = {};
  for (const row of configRows ?? []) {
    cfg[row.key] = (row.value as Record<string, unknown>) ?? {};
  }
  const attorneyFirstName =
    (cfg.attorney?.first_name as string | undefined) ?? "the attorney";
  const firmDisplayName =
    (cfg.attorney?.display_firm_name as string | undefined) ??
    "the firm";
  const fromNumber =
    (cfg.dialpad_from_number?.value as string | undefined) ?? "";
  if (!fromNumber) {
    console.error("[power_dialer] no dialpad_from_number — skipping SMS send");
    return { sent: false };
  }

  const firstName = guessFirstName(contact.full_name);
  const matterSummary = (payload.description_summary as string | undefined) ?? null;
  const clientDescription =
    (payload.client_description as string | undefined) ?? null;

  // Generate the body.
  const ai = await generateDialerSms({
    attorneyFirstName,
    firmDisplayName,
    firstName,
    matterSummary,
    clientDescription,
    state: contact.state,
  });

  // Insert ai_jobs (CLAUDE.md #5).
  if (ai.inputTokens > 0) {
    await admin.from("ai_jobs").insert({
      firm_id: firmId,
      model: ai.model,
      purpose: "power_dialer_sms",
      entity_type: "lead",
      entity_id: leadId,
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_cents: ai.costCents,
      latency_ms: ai.latencyMs,
      status: "completed",
      request_metadata: { source: "power_dialer", fell_back: ai.fellBack },
      privileged: false,
    });
  }

  // Resolve or create the conversation.
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("firm_id", firmId)
    .eq("lead_id", leadId)
    .eq("channel", "sms")
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existing?.id ?? null;
  if (!conversationId) {
    const { data: contactRow } = await admin
      .from("leads")
      .select("contact_id")
      .eq("id", leadId)
      .single();
    const { data: created } = await admin
      .from("conversations")
      .insert({
        firm_id: firmId,
        lead_id: leadId,
        contact_id: contactRow?.contact_id ?? null,
        status: "active",
        phase: "initial_contact",
        channel: "sms",
        message_count: 0,
      })
      .select("id")
      .single();
    conversationId = created?.id ?? null;
  }
  if (!conversationId) {
    console.error("[power_dialer] could not resolve conversation");
    return { sent: false };
  }

  // Insert the message as "sent" (skipping pending_approval) — outreach SMS.
  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      firm_id: firmId,
      conversation_id: conversationId,
      direction: "outbound",
      channel: "sms",
      content: ai.body,
      sender_type: "ai",
      sender_id: userId,
      ai_generated: true,
      status: "sent",
      metadata: {
        purpose: "power_dialer_no_answer_sms",
        ai_model: ai.model,
        fell_back: ai.fellBack,
      },
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    console.error("[power_dialer] message insert failed:", msgErr?.message);
    return { sent: false };
  }

  // Dispatch via Dialpad.
  let dispatchOk = false;
  let externalId: string | null = null;
  try {
    const result = await dispatchMessage(firmId, {
      channel: "sms",
      to: contact.phone,
      from: fromNumber,
      body: ai.body,
      externalRef: msg.id,
    });
    dispatchOk = true;
    externalId =
      result.channel === "sms" ? result.result.messageId ?? null : null;
  } catch (err) {
    console.error("[power_dialer] dispatchMessage failed:", err);
    dispatchOk = false;
  }

  await admin
    .from("messages")
    .update({
      external_id: externalId,
      status: dispatchOk ? "sent" : "failed",
    })
    .eq("id", msg.id);

  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  // Audit-log the SMS auto-send (separate from outcome event).
  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.sms_auto_sent",
    leadId,
    null,
    { message_id: msg.id, dispatched: dispatchOk, fell_back: ai.fellBack },
    { conversation_id: conversationId, char_count: ai.body.length },
  );

  return {
    sent: dispatchOk,
    messageId: msg.id,
    smsBody: ai.body,
  };
}

function guessFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") || /^\d/.test(trimmed)) return null; // phone-as-name
  const parts = trimmed.split(/\s+/);
  return parts[0] || null;
}

// ---------------------------------------------------------------------------
// skipLead — moves the lead to the bottom of the dialer queue
// ---------------------------------------------------------------------------

export async function skipLead(leadId: string): Promise<{ ok: true }> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const beforeDialer = ((lead.payload as Record<string, unknown> | null)?.dialer ??
    {}) as DialerState;
  const now = new Date().toISOString();
  const newPayload = mergeDialer(lead.payload as Record<string, unknown> | null, {
    status: "skipped",
    skipped_at: now,
  });
  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.skipped",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
  );

  revalidatePath("/power-dialer");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// holdLead — temporarily remove from active dialer queue
// ---------------------------------------------------------------------------

export async function holdLead(
  leadId: string,
  days = 3,
): Promise<{ ok: true; onHoldUntil: string }> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const beforeDialer = ((lead.payload as Record<string, unknown> | null)?.dialer ??
    {}) as DialerState;
  const onHoldUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const newPayload = mergeDialer(lead.payload as Record<string, unknown> | null, {
    status: "on_hold",
    on_hold_until: onHoldUntil,
  });
  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.held",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
    { hold_days: days, on_hold_until: onHoldUntil },
  );

  revalidatePath("/power-dialer");
  return { ok: true, onHoldUntil };
}

// ---------------------------------------------------------------------------
// sendSchedulingLink — when Garrison can't get a prospect on the phone right
// now, offer a calendar invite. Texts (or emails) them the firm's scheduling
// link with a short personalized note in the firm voice. Records the invite
// on `lead.payload.scheduling_invites[]` so we can see history + cadence
// against it later. Goal: capture interest before the lead goes cold.
// ---------------------------------------------------------------------------

export interface SendSchedulingLinkResult {
  ok: true;
  channel: "sms" | "email";
  sent: boolean;
  messageId?: string;
  body?: string;
  error?: string;
}

export async function sendSchedulingLink(
  leadId: string,
  channel: "sms" | "email",
): Promise<SendSchedulingLinkResult> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select(
      "id, payload, contact_id, contacts:contact_id(full_name, phone, email, state)",
    )
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");
  const contact = (
    Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
  ) as {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    state: string | null;
  } | null;
  if (!contact) throw new Error("Contact not found on lead");

  const recipient = channel === "sms" ? contact.phone : contact.email;
  if (!recipient) {
    throw new Error(
      `Lead has no ${channel === "sms" ? "phone number" : "email address"} on file.`,
    );
  }

  // Firm config: scheduling link + from-identifier + attorney name.
  const { data: cfgRows } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", [
      "scheduling_config",
      "attorney",
      "dialpad_from_number",
      "gmail_from_address",
    ]);
  const cfg: Record<string, Record<string, unknown>> = {};
  for (const r of cfgRows ?? [])
    cfg[r.key] = (r.value ?? {}) as Record<string, unknown>;

  const calendarLink =
    (cfg.scheduling_config?.calendar_link as string | undefined) ?? "";
  if (!calendarLink) {
    throw new Error(
      "No scheduling link configured. Add firm_config.scheduling_config.calendar_link (e.g. a Calendly or Google Appointments URL).",
    );
  }
  const attorneyFirstName =
    (cfg.attorney?.first_name as string | undefined) ?? "the attorney";
  const firmDisplayName =
    (cfg.attorney?.display_firm_name as string | undefined) ?? "the firm";
  const from =
    channel === "sms"
      ? ((cfg.dialpad_from_number?.value as string | undefined) ?? "")
      : ((cfg.gmail_from_address?.value as string | undefined) ?? "");
  if (!from) {
    throw new Error(
      `Firm has no ${channel === "sms" ? "dialpad_from_number" : "gmail_from_address"} configured.`,
    );
  }

  const firstName = (() => {
    const n = (contact.full_name ?? "").trim();
    if (!n) return "there";
    if (/^[\d+]/.test(n)) return "there";
    return n.split(/\s+/)[0] || "there";
  })();

  const body =
    channel === "sms"
      ? `Hi ${firstName}, this is ${attorneyFirstName} from ${firmDisplayName}. Want to grab a quick call when it works for you? You can pick a time here: ${calendarLink}`
      : `Hi ${firstName},

I wanted to make it easy to find a time to connect when it works on your end. You can grab a slot on my calendar here: ${calendarLink}

Looking forward to it.

${attorneyFirstName}
${firmDisplayName}`;
  const subject =
    channel === "email"
      ? `A quick call when it works for you`
      : undefined;

  // Resolve / create conversation.
  let conversationId: string | null = null;
  const { data: existingConvo } = await admin
    .from("conversations")
    .select("id")
    .eq("firm_id", firmId)
    .eq("lead_id", leadId)
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
        lead_id: leadId,
        contact_id: lead.contact_id,
        status: "active",
        phase: "scheduling",
        channel,
        message_count: 0,
      })
      .select("id")
      .single();
    conversationId = created?.id ?? null;
  }
  if (!conversationId) throw new Error("Failed to resolve conversation");

  // Insert message and dispatch.
  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      firm_id: firmId,
      conversation_id: conversationId,
      direction: "outbound",
      channel,
      content: body,
      sender_type: "attorney",
      sender_id: userId,
      ai_generated: false,
      status: "approved",
      metadata: {
        purpose: "scheduling_link",
        calendar_link: calendarLink,
        ...(subject ? { subject } : {}),
      },
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    throw new Error(`Failed to insert message: ${msgErr?.message}`);
  }

  let sent = false;
  let errMessage: string | undefined;
  try {
    const result = await dispatchMessage(firmId, {
      channel,
      to: recipient,
      from,
      body,
      subject,
      externalRef: msg.id,
    });
    sent = true;
    const sentAt = new Date().toISOString();
    await admin
      .from("messages")
      .update({
        status: "sent",
        external_id: result.result.messageId ?? null,
        sent_at: sentAt,
      })
      .eq("id", msg.id);
    await admin
      .from("conversations")
      .update({ last_message_at: sentAt })
      .eq("id", conversationId);
  } catch (err) {
    errMessage = err instanceof Error ? err.message : String(err);
    await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", msg.id);
  }

  // Record on lead.payload.scheduling_invites[] for visibility on the lead.
  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(payload.scheduling_invites)
    ? (payload.scheduling_invites as unknown[])
    : [];
  await admin
    .from("leads")
    .update({
      payload: {
        ...payload,
        scheduling_invites: [
          ...existing,
          {
            at: new Date().toISOString(),
            channel,
            message_id: msg.id,
            sent,
            calendar_link: calendarLink,
          },
        ].slice(-10),
      },
    })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.scheduling_link_sent",
    leadId,
    null,
    { channel, sent, message_id: msg.id, calendar_link: calendarLink },
    { error: errMessage },
  );

  return {
    ok: true,
    channel,
    sent,
    messageId: msg.id,
    body,
    error: errMessage,
  };
}

// ---------------------------------------------------------------------------
// triggerNoAnswerCadence — manual fallback when the Dialpad call-event webhook
// isn't firing (e.g. subscription not yet wired up, or delayed). Garrison
// clicks "No answer" mid-call → this fires the EXACT same cadence the webhook
// would have triggered: records outcome, sends SMS, AND initiates the 2nd
// Dialpad call. One click, full back-to-back cadence — no second manual
// Call-now click required.
//
// Internally delegates to runDialerCadenceStep with source='manual'. The
// cadence step dedupes against the webhook via call_id + 60s window so if
// the webhook fires moments later we don't double-text the lead.
// ---------------------------------------------------------------------------

export interface NoAnswerCadenceResult {
  ok: true;
  smsSent: boolean;
  smsMessageId?: string;
  secondCallInitiated: boolean;
  attempts: number;
}

export async function triggerNoAnswerCadence(
  leadId: string,
): Promise<NoAnswerCadenceResult> {
  const { firmId } = await resolveFirm();
  const admin = createAdminClient();

  // Pull the current last_call_id so the cadence step can dedup against any
  // late webhook arrival for the same call.
  const { data: lead } = await admin
    .from("leads")
    .select("payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  const payload = (lead?.payload ?? {}) as Record<string, unknown>;
  const dialer = (payload.dialer ?? {}) as { last_call_id?: string | null };
  const callId = dialer.last_call_id ?? null;

  const result = await runDialerCadenceStep({
    admin,
    firmId,
    leadId,
    trigger: "no_answer",
    callId,
    source: "manual",
  });

  return {
    ok: true,
    smsSent: result.smsSent,
    smsMessageId: result.smsMessageId,
    secondCallInitiated: result.secondCallInitiated,
    attempts: result.attempts,
  };
}

// ---------------------------------------------------------------------------
// connectAndOptionallyConvert — single round-trip "the call went well" flow.
// Always marks the lead as connected in the dialer (dialer.status = converted).
// If any of matterType/jurisdiction/summary is provided, also converts the
// lead to a real matter via convertLeadToMatter. Optionally appends a note
// to payload.notes capturing what was discussed on the call.
// ---------------------------------------------------------------------------

export interface ConnectAndConvertInput {
  leadId: string;
  matterType?: string | null;
  jurisdiction?: string | null;
  summary?: string | null;
  note?: string | null;
}

export interface ConnectAndConvertResult {
  ok: true;
  matterId: string | null;
  noteAdded: boolean;
}

export async function connectAndOptionallyConvert(
  input: ConnectAndConvertInput,
): Promise<ConnectAndConvertResult> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, status, payload, contact_id")
    .eq("id", input.leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  // Decide whether to convert.
  const wantsMatter =
    !!(input.matterType?.trim() ||
      input.jurisdiction?.trim() ||
      input.summary?.trim());

  let matterId: string | null = null;
  if (wantsMatter) {
    if (!lead.contact_id) throw new Error("Lead has no contact attached");
    if (lead.status === "converted") {
      // Already converted — skip the convert but still mark dialer state.
      matterId = null;
    } else {
      const result = await convertLeadToMatter(admin, {
        firmId,
        leadId: input.leadId,
        contactId: lead.contact_id,
        matterType: input.matterType?.trim() || null,
        jurisdiction: input.jurisdiction?.trim() || null,
        summary: input.summary?.trim() || null,
        actorId: userId,
      });
      matterId = result.matterId;
    }
  }

  // Mark dialer state = converted so the lead leaves the queue.
  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const beforeDialer = ((payload.dialer ?? {}) as DialerState) ?? {};
  const newPayload = mergeDialer(payload, {
    status: "converted",
    last_outcome: "connected",
    history: [
      {
        at: new Date().toISOString(),
        outcome: "connected" as DialerOutcome,
      },
    ],
  });

  // Append note if provided (in same payload write).
  const trimmedNote = input.note?.trim() ?? "";
  let noteAdded = false;
  if (trimmedNote) {
    const existing = Array.isArray((newPayload as Record<string, unknown>).notes)
      ? ((newPayload as Record<string, unknown>).notes as unknown[])
      : [];
    (newPayload as Record<string, unknown>).notes = [
      ...existing,
      {
        body: trimmedNote.slice(0, 4000),
        added_at: new Date().toISOString(),
        added_by: userId,
        source: "power_dialer",
      },
    ];
    noteAdded = true;
  }

  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", input.leadId)
    .eq("firm_id", firmId);

  // Follow-up sequence: when Garrison hits Connected WITHOUT immediately
  // creating a matter (still nurturing), kick off the 3-touch sequence so
  // the lead doesn't go cold. If he DID create a matter, the lead is
  // already retained — no follow-up needed; cancel any pending ones from
  // a prior Connected event on this lead.
  if (matterId) {
    await cancelPostConnectedFollowups(
      admin,
      firmId,
      input.leadId,
      "matter created",
    );
  } else if (lead.contact_id) {
    // Resolve the most recent active conversation so the worker can reuse
    // it; falls back to creating one when it fires.
    const { data: existingConvo } = await admin
      .from("conversations")
      .select("id")
      .eq("firm_id", firmId)
      .eq("lead_id", input.leadId)
      .in("status", ["active", "paused"])
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    await schedulePostConnectedFollowup({
      admin,
      firmId,
      leadId: input.leadId,
      contactId: lead.contact_id,
      conversationId: existingConvo?.id ?? null,
      callContextNote: input.note?.trim() || null,
    });
  }

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.connected",
    input.leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
    { matter_id: matterId, note_added: noteAdded },
  );

  revalidatePath("/power-dialer");
  if (matterId) {
    revalidatePath("/pipeline");
    revalidatePath("/leads");
  }
  return { ok: true, matterId, noteAdded };
}

// ---------------------------------------------------------------------------
// removeLead — permanently take out of the dialer queue (lead row preserved)
// ---------------------------------------------------------------------------

export async function removeLead(leadId: string): Promise<{ ok: true }> {
  const { firmId, userId } = await resolveFirm();
  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found");

  const beforeDialer = ((lead.payload as Record<string, unknown> | null)?.dialer ??
    {}) as DialerState;
  const newPayload = mergeDialer(lead.payload as Record<string, unknown> | null, {
    status: "removed",
  });
  await admin
    .from("leads")
    .update({ payload: newPayload })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  // Removed leads shouldn't keep getting auto-followups.
  await cancelPostConnectedFollowups(admin, firmId, leadId, "lead removed");

  await auditDialer(
    admin,
    firmId,
    userId,
    "power_dialer.removed",
    leadId,
    { dialer: beforeDialer },
    { dialer: newPayload.dialer },
  );

  revalidatePath("/power-dialer");
  return { ok: true };
}
