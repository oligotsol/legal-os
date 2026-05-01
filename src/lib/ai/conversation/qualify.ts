/**
 * Lead-stage qualification orchestrator.
 *
 * Determines which template to send based on lead status and
 * conversation phase. Pure functions — all data passed as arguments.
 */

import type {
  Lead,
  Contact,
  Conversation,
  Jurisdiction,
  DripTemplate,
} from "@/types/database";
import {
  renderTemplate,
  renderSmsTemplate,
  type TemplateContext,
} from "./template-engine";

export interface QualifyInput {
  lead: Lead;
  contact: Contact;
  conversation: Conversation;
  jurisdiction: Jurisdiction;
  templates: DripTemplate[];  // pre-fetched, filtered to lead-stage campaign
  firmConfig: Record<string, Record<string, unknown>>;
}

export interface QualifyResult {
  templateId: string;
  renderedContent: string;
  channel: "sms" | "email";
  suggestedSubject?: string;
  context: TemplateContext;
}

/** Conversation phases where qualification is still active */
const QUALIFY_PHASES = new Set([
  "initial_contact",
  "qualification",
  "scheduling",
  "follow_up",
]);

/**
 * Select the appropriate template based on conversation phase and message count.
 *
 * Templates are matched by display_order within the campaign, progressing
 * as the conversation advances. Returns null if the conversation is
 * closed/escalated or all templates are exhausted.
 */
export function selectTemplate(input: QualifyInput): DripTemplate | null {
  const { conversation, templates } = input;

  // No templates to send for closed/escalated conversations
  if (!QUALIFY_PHASES.has(conversation.phase)) {
    return null;
  }

  if (conversation.status === "closed" || conversation.status === "escalated") {
    return null;
  }

  // Filter to active templates, sorted by display_order
  const active = templates
    .filter((t) => t.active)
    .sort((a, b) => a.display_order - b.display_order);

  if (active.length === 0) return null;

  // Use message_count to determine which template to send next.
  // Each outbound message advances to the next template in sequence.
  const outboundCount = conversation.message_count;
  const templateIndex = Math.min(outboundCount, active.length - 1);

  // If we've already sent all templates, return null
  if (outboundCount >= active.length) {
    return null;
  }

  return active[templateIndex];
}

/**
 * Build the context object for template rendering.
 */
function buildContext(input: QualifyInput): TemplateContext {
  const { contact, jurisdiction, firmConfig } = input;

  const schedulingConfig = firmConfig["scheduling_config"] ?? {};
  const emailConfig = firmConfig["email_config"] ?? {};
  const paymentLanguageConfig = firmConfig["payment_language"] ?? {};

  // Derive first name from full_name
  const firstName = contact.full_name?.split(" ")[0] ?? "";

  // Get state-specific payment language if applicable
  const stateCode = jurisdiction.state_code;
  const paymentLanguage = (paymentLanguageConfig as Record<string, string>)[stateCode] ?? "";

  return {
    contact_name: contact.full_name ?? "",
    first_name: firstName,
    attorney_name: jurisdiction.attorney_name ?? "",
    attorney_email: jurisdiction.attorney_email ?? "",
    firm_name: (emailConfig["firm_name"] as string) ?? "",
    phone_number: contact.phone ?? "",
    scheduling_link: (schedulingConfig["calendar_link"] as string) ?? "",
    matter_type: input.lead.payload?.["matter_type"] as string | undefined,
    state: stateCode,
    payment_language: paymentLanguage,
  };
}

/**
 * Build a complete qualification message — selects template, builds context,
 * renders content.
 *
 * Returns null if no matching template (conversation closed/escalated or
 * all templates exhausted).
 */
export function buildQualifyMessage(input: QualifyInput): QualifyResult | null {
  const template = selectTemplate(input);
  if (!template) return null;

  const context = buildContext(input);
  const smsConfig = input.firmConfig["sms_config"] ?? {};
  const maxSmsLength = (smsConfig["max_length"] as number) ?? 300;

  const renderedContent =
    template.channel === "sms"
      ? renderSmsTemplate(template.body_template, context, maxSmsLength)
      : renderTemplate(template.body_template, context);

  const suggestedSubject =
    template.channel === "email" && template.subject
      ? renderTemplate(template.subject, context)
      : undefined;

  return {
    templateId: template.id,
    renderedContent,
    channel: template.channel,
    suggestedSubject,
    context,
  };
}
