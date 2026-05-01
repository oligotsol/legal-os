/**
 * Dropbox Sign (HelloSign) webhook handler.
 *
 * Handles signature events: signed, viewed, declined.
 * GET endpoint returns verification string per Dropbox Sign docs.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DropboxSignWebhookEventSchema } from "@/lib/integrations/dropbox-sign/types";

export async function GET() {
  // Dropbox Sign sends a GET to verify the webhook endpoint
  return new NextResponse("Hello API Event Received", { status: 200 });
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Parse webhook event
  const parsed = DropboxSignWebhookEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid webhook payload" },
      { status: 400 },
    );
  }

  const event = parsed.data;
  const eventType = event.event.event_type;
  const signatureRequestId = event.signature_request?.signature_request_id;

  if (!signatureRequestId) {
    return NextResponse.json({ received: true });
  }

  // Idempotency check — look up by e_sign_envelope_id
  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .select("id, firm_id, status, matter_id")
    .eq("e_sign_envelope_id", signatureRequestId)
    .maybeSingle();

  if (letterErr || !letter) {
    // Unknown envelope — might belong to a different service, ignore
    return NextResponse.json({ received: true, matched: false });
  }

  // Handle event types
  switch (eventType) {
    case "signature_request_all_signed": {
      if (letter.status === "signed") {
        // Already processed — idempotent
        return NextResponse.json({ received: true, idempotent: true });
      }

      const now = new Date().toISOString();

      // Update engagement letter to "signed"
      await admin
        .from("engagement_letters")
        .update({
          status: "signed",
          signed_at: now,
        })
        .eq("id", letter.id);

      // Transition matter to engagement_signed stage (if stage exists)
      const { data: stage } = await admin
        .from("pipeline_stages")
        .select("id")
        .eq("firm_id", letter.firm_id)
        .eq("slug", "engagement_signed")
        .maybeSingle();

      if (stage && letter.matter_id) {
        // Get current stage
        const { data: matter } = await admin
          .from("matters")
          .select("stage_id")
          .eq("id", letter.matter_id)
          .single();

        if (matter) {
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
      }

      // Audit log
      await admin.rpc("insert_audit_log", {
        p_firm_id: letter.firm_id,
        p_actor_id: null,
        p_action: "engagement_letter.signed",
        p_entity_type: "engagement_letter",
        p_entity_id: letter.id,
        p_before: { status: letter.status },
        p_after: { status: "signed", signed_at: now },
        p_metadata: { webhook_event: eventType, envelope_id: signatureRequestId },
      });

      break;
    }

    case "signature_request_viewed": {
      if (letter.status !== "sent") break;

      await admin
        .from("engagement_letters")
        .update({ status: "viewed" })
        .eq("id", letter.id);

      break;
    }

    case "signature_request_declined": {
      if (letter.status === "declined") break;

      await admin
        .from("engagement_letters")
        .update({ status: "declined" })
        .eq("id", letter.id);

      await admin.rpc("insert_audit_log", {
        p_firm_id: letter.firm_id,
        p_actor_id: null,
        p_action: "engagement_letter.declined",
        p_entity_type: "engagement_letter",
        p_entity_id: letter.id,
        p_before: { status: letter.status },
        p_after: { status: "declined" },
        p_metadata: { webhook_event: eventType, envelope_id: signatureRequestId },
      });

      break;
    }

    default:
      // Unhandled event type — acknowledge receipt
      break;
  }

  return NextResponse.json({ received: true });
}
