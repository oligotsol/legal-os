/**
 * Generate an engagement letter from a matter + fee quote + jurisdiction.
 *
 * Assembles all template variables and inserts a draft engagement_letters row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface GenerateLetterInput {
  firmId: string;
  matterId: string;
  feeQuoteId: string;
  actorId: string;
}

export interface EngagementLetterVariables {
  clientName: string;
  clientEmail: string | null;
  matterType: string | null;
  totalFee: number;
  lineItems: Array<{
    serviceName: string;
    amount: number;
  }>;
  ioltaRule: string | null;
  ioltaAccountType: string | null;
  earningMethod: string | null;
  milestoneSplit: number[] | null;
  requiresInformedConsent: boolean;
  effectiveDate: string;
  firmName: string;
  attorneyName: string | null;
  attorneyEmail: string | null;
  stateCode: string;
  stateName: string;
  jurisdiction: string | null;
}

export interface GenerateLetterResult {
  engagementLetterId: string;
  variables: EngagementLetterVariables;
  templateKey: string;
}

export async function generateEngagementLetter(
  admin: SupabaseClient,
  input: GenerateLetterInput,
): Promise<GenerateLetterResult> {
  const { firmId, matterId, feeQuoteId, actorId } = input;

  // 1. Fetch matter + contact
  const { data: matter, error: matterErr } = await admin
    .from("matters")
    .select("*, contacts(full_name, email, state)")
    .eq("id", matterId)
    .eq("firm_id", firmId)
    .single();

  if (matterErr || !matter) {
    throw new Error("Matter not found");
  }

  const contactRaw = matter.contacts as unknown;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    full_name: string;
    email: string | null;
    state: string | null;
  } | null;

  if (!contact) {
    throw new Error("Contact not found for matter");
  }

  // 2. Fetch fee_quote
  const { data: feeQuote, error: fqErr } = await admin
    .from("fee_quotes")
    .select("*")
    .eq("id", feeQuoteId)
    .eq("firm_id", firmId)
    .single();

  if (fqErr || !feeQuote) {
    throw new Error("Fee quote not found");
  }

  // 3. Determine state code
  const stateCode = matter.jurisdiction ?? contact.state;
  if (!stateCode) {
    throw new Error("No jurisdiction or state found on matter or contact");
  }

  // 4. Fetch jurisdiction
  const { data: jurisdiction, error: jurErr } = await admin
    .from("jurisdictions")
    .select("*")
    .eq("firm_id", firmId)
    .eq("state_code", stateCode)
    .eq("active", true)
    .maybeSingle();

  if (jurErr) {
    throw new Error(`Failed to fetch jurisdiction: ${jurErr.message}`);
  }

  if (!jurisdiction) {
    throw new Error(`No active jurisdiction found for state: ${stateCode}`);
  }

  // 5. Fetch firm info
  const { data: firm, error: firmErr } = await admin
    .from("firms")
    .select("name")
    .eq("id", firmId)
    .single();

  if (firmErr || !firm) {
    throw new Error("Firm not found");
  }

  // 6. Assemble variables
  const lineItems = (feeQuote.line_items as Array<Record<string, unknown>> ?? []).map(
    (item) => ({
      serviceName: (item.service_name as string) ?? "Service",
      amount: (item.subtotal as number) ?? 0,
    }),
  );

  const variables: EngagementLetterVariables = {
    clientName: contact.full_name,
    clientEmail: contact.email,
    matterType: matter.matter_type,
    totalFee: feeQuote.total_quoted_fee,
    lineItems,
    ioltaRule: jurisdiction.iolta_rule,
    ioltaAccountType: jurisdiction.iolta_account_type,
    earningMethod: jurisdiction.earning_method,
    milestoneSplit: jurisdiction.milestone_split,
    requiresInformedConsent: jurisdiction.requires_informed_consent,
    effectiveDate: new Date().toISOString().split("T")[0],
    firmName: firm.name,
    attorneyName: jurisdiction.attorney_name,
    attorneyEmail: jurisdiction.attorney_email,
    stateCode: jurisdiction.state_code,
    stateName: jurisdiction.state_name,
    jurisdiction: matter.jurisdiction,
  };

  // 7. Compute template key
  const templateKey = `engagement_letter_${stateCode}`;

  // 8. Insert engagement_letters row
  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .insert({
      firm_id: firmId,
      matter_id: matterId,
      fee_quote_id: feeQuoteId,
      jurisdiction_id: jurisdiction.id,
      template_key: templateKey,
      variables,
      status: "draft",
    })
    .select("id")
    .single();

  if (letterErr || !letter) {
    throw new Error(`Failed to create engagement letter: ${letterErr?.message}`);
  }

  // 9. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: actorId,
    p_action: "engagement_letter.generated",
    p_entity_type: "engagement_letter",
    p_entity_id: letter.id,
    p_before: null,
    p_after: {
      status: "draft",
      template_key: templateKey,
      matter_id: matterId,
      fee_quote_id: feeQuoteId,
      jurisdiction_id: jurisdiction.id,
    },
    p_metadata: null,
  });

  return {
    engagementLetterId: letter.id,
    variables,
    templateKey,
  };
}
