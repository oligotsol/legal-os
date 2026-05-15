/**
 * Dialpad webhook handler — multiplexed:
 *
 *   - Inbound SMS events (existing flow → processInboundMessage)
 *   - Call lifecycle events (state in: hangup / voicemail / missed / preanswer
 *     / calling) → routed to the dialer cadence orchestrator so the
 *     attorney's "No Answer (1st)" / "No Answer (2nd)" decisions are made
 *     automatically.
 *
 * The two event shapes share the same hook URL; we sniff `state` to decide
 * which branch to take.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DialpadInboundSmsSchema } from "@/lib/integrations/dialpad/types";
import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";
import {
  findLeadByCallId,
  runDialerCadenceStep,
} from "@/lib/pipeline/dialer-cadence";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Call event sniffing — Dialpad call events always carry a `state` enum
  // (hangup|voicemail|missed|preanswer|calling). SMS events don't.
  if (isCallEvent(body)) {
    return handleCallEvent(body);
  }

  const parsed = DialpadInboundSmsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const evt = parsed.data;
  const evtIdStr = String(evt.id);
  const idempotencyKey = evt.id
    ? "dialpad_" + evtIdStr
    : "dialpad_" + evt.from_number + "_" + evt.created_date;

  const admin = createAdminClient();

  // Idempotency check
  const { data: existingEvent } = await admin
    .from("webhook_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const { error: insertEventErr } = await admin.from("webhook_events").insert({
    provider: "dialpad",
    event_type: "sms.inbound",
    payload: evt as unknown as Record<string, unknown>,
    status: "processing",
    idempotency_key: idempotencyKey,
  });
  if (insertEventErr) {
    console.error("Failed to store webhook event:", insertEventErr);
  }

  // Find firms with active Dialpad integration
  const { data: integrations } = await admin
    .from("integration_accounts")
    .select("firm_id")
    .eq("provider", "dialpad")
    .eq("status", "active");

  if (!integrations || integrations.length === 0) {
    await markWebhookEvent(
      admin,
      idempotencyKey,
      "processed",
      "No active Dialpad integration found",
    );
    return NextResponse.json({ received: true, processed: false });
  }

  const firmIds = integrations.map((i) => i.firm_id);

  // Defensive: Dialpad sometimes delivers SMS notifications without the
  // text body when the subscription's `message_content_export` scope is
  // off. Persist the inbound row for audit but skip AI generation —
  // there's nothing to converse with. Surface the gap clearly via the
  // webhook_events.error column so it's diagnosable later.
  const messageText = (evt.text ?? "").trim();
  if (!messageText) {
    await processInboundMessage({
      admin,
      candidateFirmIds: firmIds,
      channel: "sms",
      fromIdentifier: evt.from_number,
      body: "(no text in webhook payload — Dialpad scope likely missing)",
      externalMessageId: evt.id ? evtIdStr : null,
      source: "dialpad",
      rawPayload: { inbound_text: evt.text, created_date: evt.created_date, empty_body: true },
      skipDraftReply: true,
    });
    await markWebhookEvent(
      admin,
      idempotencyKey,
      "processed",
      "Empty message body — Dialpad subscription may be missing message_content_export scope. Skipped AI draft.",
    );
    return NextResponse.json({
      received: true,
      processed: true,
      warning: "empty body — no AI draft generated",
    });
  }

  try {
    const result = await processInboundMessage({
      admin,
      candidateFirmIds: firmIds,
      channel: "sms",
      fromIdentifier: evt.from_number,
      body: messageText,
      externalMessageId: evt.id ? evtIdStr : null,
      source: "dialpad",
      rawPayload: { inbound_text: evt.text, created_date: evt.created_date },
    });

    await markWebhookEvent(admin, idempotencyKey, "processed");

    if (result.shortCircuit) {
      return NextResponse.json({
        received: true,
        ethics: result.disposition,
      });
    }
    return NextResponse.json({
      received: true,
      disposition: result.disposition,
      ethics: result.ethicsDisposition,
      conversation_id: result.conversationId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dialpad webhook processing failed:", message);
    await markWebhookEvent(admin, idempotencyKey, "failed", message);
    return NextResponse.json(
      { received: true, processed: false },
      { status: 500 },
    );
  }
}

async function markWebhookEvent(
  admin: ReturnType<typeof createAdminClient>,
  idempotencyKey: string,
  status: "processed" | "failed",
  error?: string,
) {
  await admin
    .from("webhook_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      ...(error ? { error } : {}),
    })
    .eq("idempotency_key", idempotencyKey);
}

// ---------------------------------------------------------------------------
// Call event branch
// ---------------------------------------------------------------------------

interface DialpadCallEvent {
  state?: string;
  call_id?: string;
  external_number?: string;
  internal_number?: string;
  direction?: "inbound" | "outbound";
  is_answered?: boolean;
  was_answered?: boolean;
  duration_seconds?: number;
  total_duration?: number;
  voicemail_link?: string;
  date_started?: string;
  date_ended?: string;
}

function isCallEvent(body: unknown): body is DialpadCallEvent {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const state = typeof b.state === "string" ? b.state : null;
  if (!state) return false;
  return ["hangup", "voicemail", "missed", "preanswer", "calling"].includes(state);
}

async function handleCallEvent(body: DialpadCallEvent): Promise<Response> {
  const admin = createAdminClient();
  const callId = body.call_id ?? null;
  const state = body.state ?? null;

  // Idempotency: combine call_id + state so repeated hangup events don't
  // double-fire the cadence. Dialpad delivers each state transition once
  // but does retry on non-200.
  const idempotencyKey = callId
    ? `dialpad_call_${callId}_${state}`
    : `dialpad_call_${state}_${body.date_started ?? Date.now()}`;
  const { data: existing } = await admin
    .from("webhook_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  await admin.from("webhook_events").insert({
    provider: "dialpad",
    event_type: `call.${state}`,
    payload: body as unknown as Record<string, unknown>,
    status: "processing",
    idempotency_key: idempotencyKey,
  });

  // Only "ended without connection" states feed the cadence. preanswer /
  // calling are informational — store them but don't act.
  const isEndedNoAnswer =
    (state === "hangup" || state === "missed" || state === "voicemail") &&
    !(body.is_answered === true || body.was_answered === true);

  if (!callId) {
    await markWebhookEvent(
      admin,
      idempotencyKey,
      "processed",
      "Call event without call_id — skipped",
    );
    return NextResponse.json({ received: true, processed: false });
  }

  if (!isEndedNoAnswer) {
    // Connected calls or interim states: record + done. Garrison marks
    // "Connected" manually when he had a real conversation.
    await markWebhookEvent(admin, idempotencyKey, "processed");
    return NextResponse.json({ received: true, action: "noop", state });
  }

  // Map call_id → lead (dialer.last_call_id == callId).
  const match = await findLeadByCallId(admin, callId);
  if (!match) {
    await markWebhookEvent(
      admin,
      idempotencyKey,
      "processed",
      "No lead found for call_id — likely inbound or unrelated call",
    );
    return NextResponse.json({ received: true, processed: false });
  }

  try {
    const result = await runDialerCadenceStep({
      admin,
      firmId: match.firmId,
      leadId: match.leadId,
      trigger: "no_answer",
      callId,
      source: "webhook",
    });
    await markWebhookEvent(admin, idempotencyKey, "processed");
    return NextResponse.json({
      received: true,
      lead_id: result.leadId,
      attempts: result.attempts,
      sms_sent: result.smsSent,
      second_call: result.secondCallInitiated,
      needs_voicemail: result.needsVoicemail,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dialpad/call] cadence failed:", msg);
    await markWebhookEvent(admin, idempotencyKey, "failed", msg);
    return NextResponse.json(
      { received: true, processed: false, error: msg },
      { status: 500 },
    );
  }
}
