/**
 * Power-dialer cadence orchestrator.
 *
 * Single place that decides "what's the next dialer step for this lead?".
 * Called from two surfaces:
 *
 *   1. The Dialpad call-event webhook (`/api/webhooks/dialpad`) — when Dialpad
 *      reports state=hangup|missed|voicemail without an answer, this kicks in
 *      automatically so Garrison doesn't have to mark "No Answer" manually.
 *
 *   2. Manual client fallback (`recordOutcomeAndSendSms` in
 *      power-dialer/actions.ts) — if the webhook is delayed or misses, the
 *      attorney can still click an outcome button as a backup.
 *
 * Step machine on `attempts`:
 *   - attempts=1 on no-answer  → send SMS + initiate 2nd Dialpad call
 *   - attempts=2 on no-answer  → set needs_voicemail flag (client surfaces
 *                                 the VM script card; Garrison reads it; then
 *                                 advances to next lead)
 *
 * "Connected" outcomes are NEVER auto-classified — Garrison clicks the button
 * himself when he had a real conversation. We can't reliably distinguish
 * "answered" from "voicemail picked up" via Dialpad state alone.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchMessage } from "@/lib/dispatch/outbound";
import { generateDialerSms } from "@/lib/ai/generate-dialer-sms";

type Admin = ReturnType<typeof createAdminClient>;

interface DialerStateShape {
  status?: "active" | "skipped" | "on_hold" | "removed" | "converted" | "needs_voicemail";
  attempts?: number;
  last_outcome?: string | null;
  last_call_at?: string | null;
  last_call_id?: string | null;
  skipped_at?: string | null;
  on_hold_until?: string | null;
  needs_voicemail?: boolean;
  history?: Array<{
    at: string;
    outcome: string;
    sms_message_id?: string | null;
    call_id?: string | null;
    source: "manual" | "webhook";
  }>;
}

export type CadenceTrigger =
  | "no_answer" // call ended without lead picking up
  | "connected" // call connected (manual only)
  | "voicemail_left"; // Garrison marked VM left

export interface CadenceStepResult {
  leadId: string;
  outcomeRecorded: string;
  attempts: number;
  smsSent: boolean;
  smsMessageId?: string;
  secondCallInitiated: boolean;
  secondCallId?: string | null;
  needsVoicemail: boolean;
}

/**
 * Apply one cadence step. Idempotent against double-fire (manual + webhook):
 * dedupes via `last_call_id` and a recent-history check on `at` timestamps.
 */
export async function runDialerCadenceStep(args: {
  admin: Admin;
  firmId: string;
  leadId: string;
  trigger: CadenceTrigger;
  callId?: string | null;
  /** Where did this trigger come from? Used for audit + dedup. */
  source: "manual" | "webhook";
}): Promise<CadenceStepResult> {
  const { admin, firmId, leadId, trigger, callId, source } = args;

  const { data: lead } = await admin
    .from("leads")
    .select(
      "id, payload, contact_id, contacts:contact_id(full_name, phone, email, state)",
    )
    .eq("id", leadId)
    .eq("firm_id", firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("Lead not found for cadence step");

  const contact = (
    Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
  ) as {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    state: string | null;
  } | null;

  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const beforeDialer = (payload.dialer ?? {}) as DialerStateShape;
  const beforeAttempts = beforeDialer.attempts ?? 0;
  const history = beforeDialer.history ?? [];

  // Dedup — two complementary checks, either one trips skip:
  //
  //   1. SEMANTIC (outcome + time): if a no_answer cadence step ran in the
  //      last 60s for this lead, don't run another. This is the strong dedup:
  //      it doesn't depend on call_id matching between paths, which is the
  //      bug that caused the double-text in testing — when Dialpad doesn't
  //      return a call_id on initiate, or the webhook reports a different
  //      call_id than what we stored, the call_id-only check silently fails
  //      open and BOTH the webhook and the manual button fire the SMS.
  //
  //   2. CALL-ID (legacy): retained for cases where the same call_id arrives
  //      twice from Dialpad (rare retry). Belt-and-suspenders.
  const dedupWindow = Date.now() - 60_000;
  const recentSameOutcome = history.find(
    (h) =>
      h.outcome === trigger &&
      new Date(h.at).getTime() > dedupWindow,
  );
  const recentMatchingCallId =
    callId &&
    history.find(
      (h) =>
        !!h.call_id &&
        h.call_id === callId &&
        new Date(h.at).getTime() > dedupWindow,
    );
  const skipSideEffects = !!recentSameOutcome || !!recentMatchingCallId;

  const now = new Date().toISOString();
  const historyEntry = {
    at: now,
    outcome: trigger,
    call_id: callId ?? null,
    source,
    sms_message_id: null as string | null,
  };

  // Race-condition guard: write the history marker FIRST so any concurrent
  // cadence-step call (e.g. webhook arrives while the manual button is
  // mid-flight) sees this entry on its read and trips the dedup. Without
  // this, two calls can both read clean history, both decide to fire, both
  // write — double SMS. Side effects happen AFTER this write succeeds.
  if (!skipSideEffects) {
    const markerDialer: DialerStateShape = {
      ...beforeDialer,
      history: [...history, historyEntry].slice(-20),
    };
    await admin
      .from("leads")
      .update({ payload: { ...payload, dialer: markerDialer } })
      .eq("id", leadId)
      .eq("firm_id", firmId);
  }

  let smsSent = false;
  let smsMessageId: string | undefined;
  let secondCallInitiated = false;
  let secondCallId: string | null | undefined;
  let needsVoicemail = beforeDialer.needs_voicemail ?? false;

  if (trigger === "no_answer" && !skipSideEffects) {
    const nextAttempts = beforeAttempts + 1;

    if (nextAttempts === 1) {
      // Send SMS, then ring the 2nd call.
      if (contact?.phone) {
        const smsResult = await sendNoAnswerSms({
          admin,
          firmId,
          leadId,
          contact,
          payload,
        });
        smsSent = smsResult.sent;
        smsMessageId = smsResult.messageId;
        historyEntry.sms_message_id = smsResult.messageId ?? null;

        // Initiate the second call.
        try {
          const c = await initiateDialpadCallServer(admin, firmId, contact.phone);
          secondCallInitiated = true;
          secondCallId = c.callId;
        } catch (err) {
          console.error("[cadence] second-call initiation failed:", err);
        }
      }
    } else if (nextAttempts >= 2) {
      // 2nd (or later) no-answer → surface VM script for Garrison to read.
      needsVoicemail = true;
    }
  } else if (trigger === "voicemail_left") {
    needsVoicemail = false;
  }

  // Persist final updated dialer state (with attempts bumped, sms_message_id
  // filled in on the marker entry, last_call_id pointing at the 2nd call if
  // we kicked one off).
  const newAttempts =
    trigger === "no_answer" && !skipSideEffects ? beforeAttempts + 1 : beforeAttempts;
  const finalHistory = skipSideEffects
    ? history // marker wasn't written; nothing to update
    : [...history, historyEntry].slice(-20);
  const newDialer: DialerStateShape = {
    ...beforeDialer,
    status: beforeDialer.status === "removed" ? "removed" : "active",
    attempts: newAttempts,
    last_outcome: trigger,
    last_call_at: now,
    last_call_id: secondCallId ?? callId ?? beforeDialer.last_call_id ?? null,
    needs_voicemail: needsVoicemail,
    history: finalHistory,
  };

  await admin
    .from("leads")
    .update({ payload: { ...payload, dialer: newDialer } })
    .eq("id", leadId)
    .eq("firm_id", firmId);

  // Audit.
  try {
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: null,
      p_action: `power_dialer.cadence_step`,
      p_entity_type: "lead",
      p_entity_id: leadId,
      p_before: { dialer: beforeDialer },
      p_after: { dialer: newDialer },
      p_metadata: {
        trigger,
        source,
        call_id: callId,
        sms_sent: smsSent,
        second_call: secondCallInitiated,
        deduped: skipSideEffects,
      },
    });
  } catch (err) {
    console.error("[cadence] audit log failed:", err);
  }

  return {
    leadId,
    outcomeRecorded: trigger,
    attempts: newAttempts,
    smsSent,
    smsMessageId,
    secondCallInitiated,
    secondCallId,
    needsVoicemail,
  };
}

/**
 * Look up a lead by Dialpad call id (matched against
 * `payload.dialer.last_call_id`). Returns null if no match — the webhook then
 * no-ops cleanly.
 */
export async function findLeadByCallId(
  admin: Admin,
  callId: string,
): Promise<{ leadId: string; firmId: string } | null> {
  if (!callId) return null;
  const { data } = await admin
    .from("leads")
    .select("id, firm_id, payload")
    .filter("payload->dialer->>last_call_id", "eq", callId)
    .is("deleted_at", null)
    .limit(1);
  if (!data || data.length === 0) return null;
  return { leadId: data[0].id, firmId: data[0].firm_id };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function sendNoAnswerSms(args: {
  admin: Admin;
  firmId: string;
  leadId: string;
  contact: {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    state: string | null;
  };
  payload: Record<string, unknown>;
}): Promise<{ sent: boolean; messageId?: string }> {
  const { admin, firmId, leadId, contact, payload } = args;
  if (!contact.phone) return { sent: false };

  const { data: configRows } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", ["attorney", "dialpad_from_number"]);
  const cfg: Record<string, Record<string, unknown>> = {};
  for (const row of configRows ?? []) {
    cfg[row.key] = (row.value as Record<string, unknown>) ?? {};
  }
  const attorneyFirstName =
    (cfg.attorney?.first_name as string | undefined) ?? "the attorney";
  const firmDisplayName =
    (cfg.attorney?.display_firm_name as string | undefined) ?? "the firm";
  const fromNumber = (cfg.dialpad_from_number?.value as string | undefined) ?? "";
  if (!fromNumber) {
    console.error("[cadence] no dialpad_from_number — skipping SMS");
    return { sent: false };
  }

  const firstName = guessFirstName(contact.full_name);
  const matterSummary = (payload.description_summary as string | undefined) ?? null;
  const clientDescription =
    (payload.client_description as string | undefined) ?? null;

  const ai = await generateDialerSms({
    attorneyFirstName,
    firmDisplayName,
    firstName,
    matterSummary,
    clientDescription,
    state: contact.state,
  });

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
      request_metadata: { source: "cadence", fell_back: ai.fellBack },
      privileged: false,
    });
  }

  // Resolve or create conversation.
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
    const { data: leadRow } = await admin
      .from("leads")
      .select("contact_id")
      .eq("id", leadId)
      .single();
    const { data: created } = await admin
      .from("conversations")
      .insert({
        firm_id: firmId,
        lead_id: leadId,
        contact_id: leadRow?.contact_id ?? null,
        status: "active",
        phase: "initial_contact",
        channel: "sms",
        message_count: 0,
      })
      .select("id")
      .single();
    conversationId = created?.id ?? null;
  }
  if (!conversationId) return { sent: false };

  const { data: msg } = await admin
    .from("messages")
    .insert({
      firm_id: firmId,
      conversation_id: conversationId,
      direction: "outbound",
      channel: "sms",
      content: ai.body,
      sender_type: "ai",
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
  if (!msg) return { sent: false };

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
    console.error("[cadence] dispatchMessage failed:", err);
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

  return { sent: dispatchOk, messageId: msg.id };
}

async function initiateDialpadCallServer(
  admin: Admin,
  firmId: string,
  toPhone: string,
): Promise<{ callId: string | null }> {
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("credentials, status")
    .eq("firm_id", firmId)
    .eq("provider", "dialpad")
    .maybeSingle();
  if (!integration || integration.status !== "active") {
    throw new Error("Dialpad integration not active");
  }
  const creds = integration.credentials as {
    apiKey?: string;
    userId?: string | number;
  } | null;
  if (!creds?.apiKey || !creds.userId) {
    throw new Error("Dialpad credentials missing");
  }
  const baseUrl =
    process.env.DIALPAD_API_BASE_URL ?? "https://dialpad.com/api/v2";
  const res = await fetch(`${baseUrl}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ user_id: creds.userId, phone_number: toPhone }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dialpad ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const callId =
    (typeof json.id === "string" && json.id) ||
    (typeof json.call_id === "string" && json.call_id) ||
    null;
  return { callId };
}

function guessFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") || /^\d/.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0] || null;
}
