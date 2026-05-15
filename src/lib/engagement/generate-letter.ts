/**
 * Generate an engagement letter from a matter + fee quote.
 *
 * Fetches the six firm_config rows that feed the universal letter template
 * (engagement_letter_template, jurisdiction_schedule,
 * attorney_of_record_by_jurisdiction, expenses_addendum_schedule, firm_identity,
 * branding), assembles the RenderLetterContext, and snapshots both the context
 * and the template body into engagement_letters so the letter renders
 * identically forever even if firm_config later changes.
 *
 * No inline defaults: any missing firm_config row throws (CLAUDE.md §7).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RenderLetterContext,
  FirmIdentity,
  Branding,
  JurisdictionScheduleEntry,
  AttorneyEntry,
  ExpensesAddendumSchedule,
  StateCode,
} from "./render-letter";

export interface GenerateLetterInput {
  firmId: string;
  matterId: string;
  feeQuoteId: string;
  actorId: string;
}

export interface GenerateLetterResult {
  engagementLetterId: string;
  context: RenderLetterContext;
}

const REQUIRED_FIRM_CONFIG_KEYS = [
  "engagement_letter_template",
  "jurisdiction_schedule",
  "attorney_of_record_by_jurisdiction",
  "expenses_addendum_schedule",
  "firm_identity",
  "branding",
] as const;

type FirmConfigKey = (typeof REQUIRED_FIRM_CONFIG_KEYS)[number];

interface FirmConfigBundle {
  engagement_letter_template: string;
  jurisdiction_schedule: Record<StateCode, JurisdictionScheduleEntry>;
  attorney_of_record_by_jurisdiction: Record<StateCode, AttorneyEntry>;
  expenses_addendum_schedule: ExpensesAddendumSchedule;
  firm_identity: FirmIdentity;
  branding: Branding;
}

async function loadFirmConfigBundle(
  admin: SupabaseClient,
  firmId: string,
): Promise<FirmConfigBundle> {
  const { data, error } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", REQUIRED_FIRM_CONFIG_KEYS as unknown as string[]);

  if (error) {
    throw new Error(`Failed to load firm_config: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ key: FirmConfigKey; value: unknown }>;
  const byKey = new Map<FirmConfigKey, unknown>();
  for (const row of rows) {
    byKey.set(row.key, row.value);
  }

  const missing = REQUIRED_FIRM_CONFIG_KEYS.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    throw new Error(
      `Missing firm_config rows for engagement letter: ${missing.join(", ")}. ` +
        `Seed these via the LFL setup migration (#92) before generating a letter.`,
    );
  }

  const tmpl = byKey.get("engagement_letter_template");
  // engagement_letter_template may be stored as JSONB string or as { html: "..." }
  const templateBody =
    typeof tmpl === "string"
      ? tmpl
      : typeof (tmpl as { html?: unknown })?.html === "string"
        ? (tmpl as { html: string }).html
        : null;
  if (!templateBody) {
    throw new Error(
      "firm_config.engagement_letter_template must be a string or { html: string }",
    );
  }

  return {
    engagement_letter_template: templateBody,
    jurisdiction_schedule: byKey.get("jurisdiction_schedule") as Record<
      StateCode,
      JurisdictionScheduleEntry
    >,
    attorney_of_record_by_jurisdiction: byKey.get(
      "attorney_of_record_by_jurisdiction",
    ) as Record<StateCode, AttorneyEntry>,
    expenses_addendum_schedule: byKey.get(
      "expenses_addendum_schedule",
    ) as ExpensesAddendumSchedule,
    firm_identity: byKey.get("firm_identity") as FirmIdentity,
    branding: byKey.get("branding") as Branding,
  };
}

function buildServicesDescription(
  lineItems: Array<{ service_name?: unknown; subtotal?: unknown }>,
): string {
  if (lineItems.length === 0) return "";
  return lineItems
    .map((item) => {
      const name = typeof item.service_name === "string" ? item.service_name : "Service";
      return name;
    })
    .join("; ");
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

  // 3. Validate jurisdiction + practice area
  const jurisdiction = (matter.jurisdiction as string | null) ?? contact.state;
  if (!jurisdiction) {
    throw new Error("No jurisdiction or state found on matter or contact");
  }

  const practiceArea = matter.matter_type as string | null;
  if (!practiceArea) {
    throw new Error(
      "Matter has no matter_type; required to select the practice-area expenses block",
    );
  }

  // 4. Load firm_config bundle (throws if anything missing)
  const firmConfig = await loadFirmConfigBundle(admin, firmId);

  if (!firmConfig.jurisdiction_schedule[jurisdiction]) {
    throw new Error(
      `firm_config.jurisdiction_schedule has no entry for jurisdiction "${jurisdiction}"`,
    );
  }
  if (!firmConfig.attorney_of_record_by_jurisdiction[jurisdiction]) {
    throw new Error(
      `firm_config.attorney_of_record_by_jurisdiction has no entry for jurisdiction "${jurisdiction}"`,
    );
  }
  if (!firmConfig.expenses_addendum_schedule.by_practice_area[practiceArea]) {
    throw new Error(
      `firm_config.expenses_addendum_schedule has no entry for practice_area "${practiceArea}"`,
    );
  }

  // 5. Assemble render context
  const lineItems = (feeQuote.line_items as Array<Record<string, unknown>>) ?? [];
  const totalFee = Number(feeQuote.total_quoted_fee ?? 0);
  const deposit = Number(feeQuote.deposit_amount ?? totalFee); // default deposit = full fee for flat-fee model

  const context: RenderLetterContext = {
    client_name: contact.full_name,
    agreement_date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    jurisdiction,
    practice_area: practiceArea,
    engagement_fee_amount: totalFee,
    deposit_amount: deposit,
    services_description: buildServicesDescription(lineItems),
    firm_identity: firmConfig.firm_identity,
    branding: firmConfig.branding,
    jurisdiction_schedule: firmConfig.jurisdiction_schedule,
    attorney_of_record_by_jurisdiction:
      firmConfig.attorney_of_record_by_jurisdiction,
    expenses_addendum_schedule: firmConfig.expenses_addendum_schedule,
  };

  // 6. Snapshot template + context into engagement_letters
  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .insert({
      firm_id: firmId,
      matter_id: matterId,
      fee_quote_id: feeQuoteId,
      template_key: "engagement_letter_universal",
      template_snapshot: firmConfig.engagement_letter_template,
      variables: context,
      status: "draft",
    })
    .select("id")
    .single();

  if (letterErr || !letter) {
    throw new Error(`Failed to create engagement letter: ${letterErr?.message}`);
  }

  // 7. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: actorId,
    p_action: "engagement_letter.generated",
    p_entity_type: "engagement_letter",
    p_entity_id: letter.id,
    p_before: null,
    p_after: {
      status: "draft",
      matter_id: matterId,
      fee_quote_id: feeQuoteId,
      jurisdiction,
      practice_area: practiceArea,
    },
    p_metadata: null,
  });

  return {
    engagementLetterId: letter.id,
    context,
  };
}
