/**
 * Send an approved engagement letter for e-signature.
 *
 * Verifies the letter is in "approved" status (mandatory gate),
 * then calls the Dropbox Sign adapter (or dry run if no credentials).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSignatureRequest,
  createSignatureRequestDryRun,
} from "@/lib/integrations/dropbox-sign/esign";
import type { EngagementLetterVariables } from "./generate-letter";

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

  const variables = letter.variables as EngagementLetterVariables;

  // 4. Build document content from variables
  const documentContent = buildDocumentContent(variables);

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
    subject: `Engagement Letter - ${variables.firmName}`,
    message: `Please review and sign the engagement letter for ${variables.matterType ?? "legal services"}.`,
    title: `Engagement Letter - ${contact.full_name}`,
    documentContent,
    externalRef: engagementLetterId,
  };

  let envelopeId: string;
  let dryRun: boolean;

  if (integration) {
    // Real call
    const result = await createSignatureRequest(
      integration.credentials as Record<string, unknown>,
      signatureInput,
    );
    envelopeId = result.envelopeId;
    dryRun = false;
  } else {
    // Dry run — no active integration
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

/**
 * Build a plain text document from engagement letter variables.
 * This is a simple text representation — full PDF rendering is v2.
 */
function buildDocumentContent(variables: EngagementLetterVariables): string {
  const lines: string[] = [
    `ENGAGEMENT LETTER`,
    ``,
    `Date: ${variables.effectiveDate}`,
    ``,
    `${variables.firmName}`,
    variables.attorneyName ? `Attorney: ${variables.attorneyName}` : "",
    ``,
    `Dear ${variables.clientName},`,
    ``,
    `This letter confirms the terms of our engagement to provide legal services.`,
    ``,
    `SCOPE OF SERVICES`,
    `Matter Type: ${variables.matterType ?? "Legal Services"}`,
    `Jurisdiction: ${variables.stateName} (${variables.stateCode})`,
    ``,
    `FEE SCHEDULE`,
  ];

  for (const item of variables.lineItems) {
    lines.push(`  - ${item.serviceName}: $${item.amount.toFixed(2)}`);
  }

  lines.push(
    ``,
    `Total Fee: $${variables.totalFee.toFixed(2)}`,
    ``,
  );

  if (variables.ioltaRule) {
    lines.push(
      `TRUST ACCOUNT`,
      `${variables.ioltaRule}`,
      `Account Type: ${variables.ioltaAccountType ?? "Trust"}`,
      `Earning Method: ${variables.earningMethod ?? "N/A"}`,
      ``,
    );
  }

  if (variables.milestoneSplit && variables.milestoneSplit.length > 0) {
    lines.push(
      `PAYMENT MILESTONES`,
      ...variables.milestoneSplit.map(
        (pct, i) => `  Milestone ${i + 1}: ${pct}%`,
      ),
      ``,
    );
  }

  if (variables.requiresInformedConsent) {
    lines.push(
      `INFORMED CONSENT`,
      `Your jurisdiction requires informed consent for this engagement.`,
      `By signing below, you acknowledge that you have been informed of and consent to the terms of this engagement.`,
      ``,
    );
  }

  lines.push(
    `By signing below, you agree to the terms of this engagement letter.`,
    ``,
    `Client Signature: ___________________________`,
    `Date: ___________________________`,
    ``,
    `${variables.firmName}`,
    variables.attorneyName ?? "",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}
