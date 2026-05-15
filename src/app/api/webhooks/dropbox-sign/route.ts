/**
 * Dropbox Sign webhook handler.
 *
 * Receives signature request lifecycle events (viewed, signed,
 * all-signed, declined, expired/canceled) and updates the corresponding
 * engagement_letters row by e_sign_envelope_id. On signed, transitions
 * the matter to the engagement_signed stage and creates the deposit
 * invoice (Confido dry-run until credentials arrive).
 *
 * Payload format: Dropbox Sign sends multipart/form-data with one `json`
 * field. Earlier implementation read JSON directly -- that did not work
 * against the live API.
 *
 * Multi-signer note: an engagement_letter is marked status=signed only when
 * `signature_request_all_signed` fires (or `signature_request_signed` with
 * is_complete=true). Individual signer events update no status -- the
 * document isn't binding until all signers have signed.
 *
 * Signature verification: Dropbox Sign signs each webhook with
 * HMAC-SHA256(api_key, event_time + event_type) and embeds it as
 * event.event_hash. If the firm's API key is stored in integration_accounts,
 * verify; if not (dry-run mode), accept.
 *
 * Dropbox Sign requires the response body to be exactly
 * "Hello API Event Received".
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { DropboxSignWebhookEventSchema } from "@/lib/integrations/dropbox-sign/types";
import { createInvoiceOnSigned } from "@/lib/engagement/create-invoice-on-signed";

const HELLO_RESPONSE = "Hello API Event Received";

interface ResolvedLetter {
  id: string;
  firm_id: string;
  status: string;
  matter_id: string;
}

export async function GET(): Promise<Response> {
  // Dropbox Sign sends a GET to verify the webhook endpoint
  return new NextResponse(HELLO_RESPONSE, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  // Dropbox Sign sends `multipart/form-data` with one `json` field.
  // (Some local tooling may post raw JSON; accept both.)
  const contentType = req.headers.get("content-type") ?? "";
  let payloadJson: string;
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      const raw = form.get("json");
      if (typeof raw !== "string") {
        return new NextResponse("missing json field", { status: 400 });
      }
      payloadJson = raw;
    } catch {
      return new NextResponse("invalid form payload", { status: 400 });
    }
  } else {
    payloadJson = await req.text();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payloadJson);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  const parsed = DropboxSignWebhookEventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return new NextResponse("invalid webhook schema", { status: 400 });
  }

  const event = parsed.data.event;
  const envelopeId = parsed.data.signature_request?.signature_request_id;

  // `callback_test` event fires when you configure the URL.
  if (event.event_type === "callback_test") {
    return new NextResponse(HELLO_RESPONSE, { status: 200 });
  }

  if (!envelopeId) {
    return new NextResponse(HELLO_RESPONSE, { status: 200 });
  }

  const admin = createAdminClient();

  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .select("id, firm_id, status, matter_id")
    .eq("e_sign_envelope_id", envelopeId)
    .maybeSingle();

  if (letterErr || !letter) {
    console.warn(
      `[dropbox-sign webhook] unknown envelope ${envelopeId}: ${letterErr?.message ?? "no row"}`,
    );
    return new NextResponse(HELLO_RESPONSE, { status: 200 });
  }

  const resolved: ResolvedLetter = letter;

  // Signature verification (skipped silently if no API key on file)
  const verified = await verifyWebhookSignature(admin, resolved.firm_id, payloadJson);
  if (verified === "invalid") {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const newStatus = mapEventToStatus(
    event.event_type,
    parsed.data.signature_request?.is_complete ?? false,
  );

  if (!newStatus) {
    // Event we don't act on (sent, reminder, etc.). Audit-log it anyway.
    await admin.rpc("insert_audit_log", {
      p_firm_id: resolved.firm_id,
      p_actor_id: null,
      p_action: `engagement_letter.dropbox_sign_event.${event.event_type}`,
      p_entity_type: "engagement_letter",
      p_entity_id: resolved.id,
      p_before: null,
      p_after: { event_type: event.event_type, envelope_id: envelopeId },
      p_metadata: { source: "dropbox_sign_webhook", verified },
    });
    return new NextResponse(HELLO_RESPONSE, { status: 200 });
  }

  // Idempotent against duplicate webhook deliveries.
  if (resolved.status === newStatus) {
    return new NextResponse(HELLO_RESPONSE, { status: 200 });
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "signed") {
    updates.signed_at = new Date().toISOString();
  }

  const { error: updateErr } = await admin
    .from("engagement_letters")
    .update(updates)
    .eq("id", resolved.id)
    .eq("firm_id", resolved.firm_id);

  if (updateErr) {
    console.error(
      `[dropbox-sign webhook] update failed for ${resolved.id}: ${updateErr.message}`,
    );
    return new NextResponse("update failed", { status: 500 });
  }

  await admin.rpc("insert_audit_log", {
    p_firm_id: resolved.firm_id,
    p_actor_id: null,
    p_action: `engagement_letter.${newStatus}`,
    p_entity_type: "engagement_letter",
    p_entity_id: resolved.id,
    p_before: { status: resolved.status },
    p_after: { status: newStatus, envelope_id: envelopeId },
    p_metadata: { source: "dropbox_sign_webhook", event_type: event.event_type, verified },
  });

  // On signed: transition matter to engagement_signed + create deposit invoice.
  if (newStatus === "signed" && resolved.matter_id) {
    await advanceMatterToSignedStage(admin, resolved);
    try {
      await createInvoiceOnSigned(admin, {
        firmId: resolved.firm_id,
        engagementLetterId: resolved.id,
        actorId: null,
      });
    } catch (err) {
      console.error(
        `[dropbox-sign webhook] post-sign invoice creation failed for letter ${resolved.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return new NextResponse(HELLO_RESPONSE, { status: 200 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapEventToStatus(
  eventType: string,
  isComplete: boolean,
): "viewed" | "signed" | "declined" | "expired" | null {
  switch (eventType) {
    case "signature_request_viewed":
      return "viewed";
    case "signature_request_all_signed":
      return "signed";
    case "signature_request_signed":
      // Multi-signer: only flip to "signed" when the full request is complete.
      return isComplete ? "signed" : null;
    case "signature_request_declined":
      return "declined";
    case "signature_request_canceled":
    case "signature_request_expired":
      return "expired";
    default:
      return null;
  }
}

async function advanceMatterToSignedStage(
  admin: ReturnType<typeof createAdminClient>,
  letter: ResolvedLetter,
): Promise<void> {
  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("firm_id", letter.firm_id)
    .eq("slug", "engagement_signed")
    .maybeSingle();

  if (!stage) return;

  const { data: matter } = await admin
    .from("matters")
    .select("stage_id")
    .eq("id", letter.matter_id)
    .single();
  if (!matter) return;

  if (matter.stage_id === stage.id) return; // already there

  await admin
    .from("matters")
    .update({ stage_id: stage.id })
    .eq("id", letter.matter_id);

  await admin.from("matter_stage_history").insert({
    firm_id: letter.firm_id,
    matter_id: letter.matter_id,
    from_stage_id: matter.stage_id,
    to_stage_id: stage.id,
    actor_id: null,
    reason: "Engagement letter signed by client",
  });
}

async function verifyWebhookSignature(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  rawPayloadJson: string,
): Promise<"valid" | "skipped" | "invalid"> {
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("credentials")
    .eq("firm_id", firmId)
    .eq("provider", "dropbox_sign")
    .eq("status", "active")
    .maybeSingle();

  const creds = integration?.credentials as { apiKey?: string } | undefined;
  if (!creds?.apiKey) {
    return "skipped";
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayloadJson);
  } catch {
    return "invalid";
  }
  const event = (
    payload as {
      event?: { event_time?: string; event_type?: string; event_hash?: string };
    }
  ).event;
  if (!event?.event_time || !event.event_type || !event.event_hash) {
    return "invalid";
  }

  const expected = createHmac("sha256", creds.apiKey)
    .update(event.event_time + event.event_type)
    .digest("hex");

  const aBuf = Buffer.from(expected, "hex");
  const bBuf = Buffer.from(event.event_hash, "hex");
  if (aBuf.length !== bBuf.length) return "invalid";
  return timingSafeEqual(aBuf, bBuf) ? "valid" : "invalid";
}
