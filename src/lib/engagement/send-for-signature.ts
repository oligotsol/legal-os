/**
 * Send an approved engagement letter for e-signature.
 *
 * Verifies the letter is in "approved" status (mandatory gate),
 * renders the snapshotted template + context to HTML, and ships the document
 * to Dropbox Sign (or dry-runs when no integration is configured).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSignatureRequest,
  createSignatureRequestDryRun,
} from "@/lib/integrations/dropbox-sign/esign";
import {
  renderLetterHtml,
  type RenderLetterContext,
} from "./render-letter";

export interface SendForSignatureInput {
  firmId: string;
  engagementLetterId: string;
  actorId: string;
}

export interface SendForSignatureResult {
  envelopeId: string;
  dryRun: boolean;
}

export async function sendEngagementForSignature(
  admin: SupabaseClient,
  input: SendForSignatureInput,
): Promise<SendForSignatureResult> {
  const { firmId, engagementLetterId, actorId } = input;

  // 1. Fetch engagement letter
  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .select("*, matters(contacts(full_name, email))")
    .eq("id", engagementLetterId)
    .eq("firm_id", firmId)
    .single();

  if (letterErr || !letter) {
    throw new Error("Engagement letter not found");
  }

  // 2. Verify status is "approved" (mandatory gate)
  if (letter.status !== "approved") {
    throw new Error(
      `Engagement letter must be approved before sending. Current status: ${letter.status}`,
    );
  }

  // 3. Get contact info from matter → contact join
  const matterRaw = letter.matters as unknown;
  const matterData = (Array.isArray(matterRaw) ? matterRaw[0] : matterRaw) as {
    contacts: unknown;
  } | null;

  const contactRaw = matterData?.contacts as unknown;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    full_name: string;
    email: string | null;
  } | null;

  if (!contact?.email) {
    throw new Error("Contact email is required for e-signature");
  }

  // 4. Render the document from the snapshotted template + context
  const template = letter.template_snapshot as string | null;
  if (!template) {
    throw new Error(
      "Engagement letter has no template_snapshot; regenerate the letter to populate it",
    );
  }
  const context = letter.variables as RenderLetterContext;
  const documentContent = renderLetterHtml(template, context);

  // 5. Check for Dropbox Sign integration account
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("credentials, status")
    .eq("firm_id", firmId)
    .eq("provider", "dropbox_sign")
    .eq("status", "active")
    .maybeSingle();

  const signatureInput = {
    signerEmail: contact.email,
    signerName: contact.full_name,
    subject: `Engagement Letter - ${context.firm_identity.legal_name}`,
    message: `Please review and sign the engagement letter for ${context.practice_area ?? "legal services"}.`,
    title: `Engagement Letter - ${contact.full_name}`,
    documentContent,
    externalRef: engagementLetterId,
  };

  let envelopeId: string;
  let dryRun: boolean;

  if (integration) {
    const result = await createSignatureRequest(
      integration.credentials as Record<string, unknown>,
      signatureInput,
    );
    envelopeId = result.envelopeId;
    dryRun = false;
  } else {
    const result = createSignatureRequestDryRun(signatureInput);
    envelopeId = result.envelopeId;
    dryRun = true;
  }

  // 6. Update engagement letter
  const { error: updateErr } = await admin
    .from("engagement_letters")
    .update({
      e_sign_provider: "dropbox_sign",
      e_sign_envelope_id: envelopeId,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", engagementLetterId)
    .eq("firm_id", firmId);

  if (updateErr) {
    throw new Error(`Failed to update engagement letter: ${updateErr.message}`);
  }

  // 7. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: actorId,
    p_action: "engagement_letter.sent_for_signature",
    p_entity_type: "engagement_letter",
    p_entity_id: engagementLetterId,
    p_before: { status: "approved" },
    p_after: {
      status: "sent",
      e_sign_provider: "dropbox_sign",
      e_sign_envelope_id: envelopeId,
      dry_run: dryRun,
    },
    p_metadata: null,
  });

  return { envelopeId, dryRun };
}
