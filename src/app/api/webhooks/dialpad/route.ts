/**
 * Dialpad inbound SMS webhook.
 *
 * Handles protocol-specific concerns (parsing, validation, idempotency,
 * integration discovery), then hands the normalized payload to the shared
 * processInboundMessage helper.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DialpadInboundSmsSchema } from "@/lib/integrations/dialpad/types";
import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
