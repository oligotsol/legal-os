/**
 * Postmark inbound email webhook.
 *
 * Postmark posts inbound JSON to this URL when an email lands in a configured
 * inbound stream (replies to engagement letters, fee quotes, transactional
 * threads). Hands the normalized payload to the shared processInboundMessage
 * helper so the email behaves identically to Dialpad SMS and Gmail-polled mail.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PostmarkInboundWebhookSchema } from "@/lib/integrations/postmark/types";
import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostmarkInboundWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const event = parsed.data;
  const fromEmail = (event.FromFull?.Email ?? event.From).toLowerCase().trim();
  const fromName = event.FromFull?.Name ?? event.FromName ?? null;
  const idempotencyKey = `postmark_${event.MessageID}`;

  const admin = createAdminClient();

  const { data: existingEvent } = await admin
    .from("webhook_events")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const { error: insertEventErr } = await admin.from("webhook_events").insert({
    provider: "postmark",
    event_type: "email.inbound",
    payload: event as unknown as Record<string, unknown>,
    status: "processing",
    idempotency_key: idempotencyKey,
  });
  if (insertEventErr) {
    console.error("Failed to store Postmark webhook event:", insertEventErr);
  }

  // Find firms with active Postmark integration. If a firm uses Postmark for
  // outbound and routes its inbound stream here, it should have a Postmark
  // integration_account row. Fall back to any firm matching the recipient
  // domain in a follow-up if needed.
  const { data: integrations } = await admin
    .from("integration_accounts")
    .select("firm_id")
    .eq("provider", "postmark")
    .eq("status", "active");

  if (!integrations || integrations.length === 0) {
    await markWebhookEvent(
      admin,
      idempotencyKey,
      "processed",
      "No active Postmark integration found",
    );
    return NextResponse.json({ received: true, processed: false });
  }

  const firmIds = integrations.map((i) => i.firm_id);

  try {
    const result = await processInboundMessage({
      admin,
      candidateFirmIds: firmIds,
      channel: "email",
      fromIdentifier: fromEmail,
      fromDisplayName: fromName,
      body: event.TextBody || event.Subject,
      externalMessageId: event.MessageID,
      source: "postmark",
      rawPayload: {
        subject: event.Subject,
        text_preview: event.TextBody.slice(0, 500),
        postmark_message_id: event.MessageID,
        message_stream: event.MessageStream ?? null,
      },
      subjectHint: event.Subject,
    });

    await markWebhookEvent(admin, idempotencyKey, "processed");

    if (result.shortCircuit) {
      return NextResponse.json({
        received: true,
        ethics: result.disposition,
      });
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Postmark webhook processing failed:", message);
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
