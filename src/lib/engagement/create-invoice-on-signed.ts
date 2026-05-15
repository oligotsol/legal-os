/**
 * On engagement_letter signed, create the invoice row + Confido payment link
 * (dry-run path until credentials arrive) + enqueue invoice for approval.
 *
 * Invoice is a CLAUDE.md §3 mandatory-approval action -- it lands in
 * approval_queue at status="pending_approval" until an attorney clears it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPaymentLink,
  createPaymentLinkDryRun,
  ConfidoError,
} from "@/lib/integrations/confido/payments";
import type { RenderLetterContext } from "./render-letter";

export interface CreateInvoiceOnSignedInput {
  firmId: string;
  engagementLetterId: string;
  actorId?: string | null;
}

export interface CreateInvoiceOnSignedResult {
  invoiceId: string;
  paymentProviderId: string;
  paymentUrl: string;
  dryRun: boolean;
}

export async function createInvoiceOnSigned(
  admin: SupabaseClient,
  input: CreateInvoiceOnSignedInput,
): Promise<CreateInvoiceOnSignedResult> {
  const { firmId, engagementLetterId, actorId } = input;

  // 1. Fetch the signed engagement letter
  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .select("id, matter_id, fee_quote_id, variables, status, matters(contacts(full_name, email))")
    .eq("id", engagementLetterId)
    .eq("firm_id", firmId)
    .single();

  if (letterErr || !letter) {
    throw new Error(`Engagement letter ${engagementLetterId} not found`);
  }
  if (letter.status !== "signed") {
    throw new Error(
      `createInvoiceOnSigned called for letter in status "${letter.status}" -- expected "signed"`,
    );
  }

  const context = letter.variables as RenderLetterContext;
  const amount = context.deposit_amount ?? context.engagement_fee_amount;
  if (!amount || amount <= 0) {
    throw new Error("Engagement letter has no positive deposit/fee amount");
  }

  // 2. Resolve client name + email from the joined contact
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
    throw new Error("Contact email required to create a payment link");
  }

  // 3. Check for an active Confido integration
  const { data: integration } = await admin
    .from("integration_accounts")
    .select("credentials, status")
    .eq("firm_id", firmId)
    .eq("provider", "confido")
    .eq("status", "active")
    .maybeSingle();

  const paymentInput = {
    amount,
    currency: "USD",
    description: `Engagement Fee Deposit -- ${context.firm_identity.legal_name}`,
    clientName: contact.full_name,
    clientEmail: contact.email,
    externalRef: engagementLetterId,
  };

  let providerId: string;
  let paymentUrl: string;
  let dryRun: boolean;
  if (integration) {
    try {
      const result = await createPaymentLink(
        integration.credentials as Record<string, unknown>,
        paymentInput,
      );
      providerId = result.providerId;
      paymentUrl = result.paymentUrl;
      dryRun = false;
    } catch (err) {
      // Confido live path is stubbed -- fall through to dry-run so the flow
      // still produces an invoice during testing.
      if (err instanceof ConfidoError) {
        const dry = createPaymentLinkDryRun(paymentInput);
        providerId = dry.providerId;
        paymentUrl = dry.paymentUrl;
        dryRun = true;
      } else {
        throw err;
      }
    }
  } else {
    const dry = createPaymentLinkDryRun(paymentInput);
    providerId = dry.providerId;
    paymentUrl = dry.paymentUrl;
    dryRun = true;
  }

  // 4. Insert the invoices row
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .insert({
      firm_id: firmId,
      matter_id: letter.matter_id,
      fee_quote_id: letter.fee_quote_id,
      engagement_letter_id: engagementLetterId,
      amount,
      payment_provider: "confido",
      payment_provider_id: providerId,
      payment_link: paymentUrl,
      status: "pending_approval",
      metadata: { dry_run: dryRun },
    })
    .select("id")
    .single();

  if (invErr || !invoice) {
    throw new Error(`Failed to create invoice: ${invErr?.message}`);
  }

  // 5. Enqueue invoice for attorney approval (CLAUDE.md §3 hard gate)
  const { error: queueErr } = await admin.from("approval_queue").insert({
    firm_id: firmId,
    entity_type: "invoice",
    entity_id: invoice.id,
    action_type: "invoice",
    priority: 5,
    status: "pending",
    metadata: {
      engagement_letter_id: engagementLetterId,
      amount,
      dry_run: dryRun,
    },
  });

  if (queueErr) {
    throw new Error(`Failed to enqueue invoice for approval: ${queueErr.message}`);
  }

  // 6. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: actorId ?? null,
    p_action: "invoice.created_on_letter_signed",
    p_entity_type: "invoice",
    p_entity_id: invoice.id,
    p_before: null,
    p_after: {
      status: "pending_approval",
      amount,
      payment_provider: "confido",
      payment_provider_id: providerId,
      dry_run: dryRun,
    },
    p_metadata: { engagement_letter_id: engagementLetterId, source: "dropbox_sign_webhook" },
  });

  return {
    invoiceId: invoice.id,
    paymentProviderId: providerId,
    paymentUrl,
    dryRun,
  };
}
