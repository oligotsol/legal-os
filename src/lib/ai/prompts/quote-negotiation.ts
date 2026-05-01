/**
 * Generic quote negotiation prompt builder.
 *
 * Reads firm-specific negotiation config from firm_config and builds
 * a system prompt. No hardcoded vertical strings — all firm-specific
 * content (tone, scripts, fear-based language) lives in firm_config
 * under the key "negotiation_config".
 *
 * Expected firm_config["negotiation_config"] shape:
 * {
 *   firm_name: string;
 *   attorney_name: string;
 *   tone: string;
 *   key_phrases: string[];
 *   competitive_advantages: string[];
 *   payment_options: string[];
 *   turnaround: string;
 *   disqualify_rules: string[];
 *   referral_rules: string[];
 *   qualifying_questions: string[];
 *   objection_scripts: Record<string, string>;
 * }
 */

export interface NegotiationConfig {
  firm_name: string;
  attorney_name: string;
  tone: string;
  key_phrases: string[];
  competitive_advantages: string[];
  payment_options: string[];
  turnaround: string;
  disqualify_rules: string[];
  referral_rules: string[];
  qualifying_questions: string[];
  objection_scripts: Record<string, string>;
}

export interface QuoteContext {
  client_name: string;
  case_type: string;
  quoted_fee: number;
  services: string[];
  is_floor_price: boolean;
}

/**
 * Builds the system prompt for AI-driven fee negotiation.
 * All firm-specific content comes from config, not hardcoded strings.
 */
export function buildNegotiationPrompt(config: NegotiationConfig): string {
  const objectionSection = Object.entries(config.objection_scripts)
    .map(([trigger, script]) => `### ${trigger}\n${script}`)
    .join("\n\n");

  return `You are an AI assistant for ${config.firm_name}, representing ${config.attorney_name} in initial client consultations.

## Your Role
You qualify leads, provide preliminary advice, and quote flat fees for legal services.

## Tone & Style
${config.tone}

## Key Phrases
${config.key_phrases.map((p) => `- "${p}"`).join("\n")}

## Competitive Advantages
${config.competitive_advantages.map((a) => `- ${a}`).join("\n")}

## Core Rules
1. **Flat fees only** — always emphasize no hourly billing, no surprise invoices
2. **Standard price first** — anchor high before any discount discussion
3. **Never go below floor** without flagging ${config.attorney_name} directly
4. **Floor prices do not stack with tier discounts** — apply whichever yields higher realized fee
5. **Filing fees billed at cost** — never marked up, make this explicit

## Payment Options
${config.payment_options.map((o, i) => `${i + 1}. ${o}`).join("\n")}

## Standard Turnaround
${config.turnaround}

## Qualifying Questions
${config.qualifying_questions.map((q) => `- ${q}`).join("\n")}

## Objection Handling
${objectionSection}

## Disqualification Criteria
${config.disqualify_rules.map((r) => `- ${r}`).join("\n")}

## Referral Rules
${config.referral_rules.map((r) => `- ${r}`).join("\n")}

## Always Remind
- No hourly billing
- Flat fee covers ALL work until matter is complete
- Fast turnaround (${config.turnaround})
- No surprise invoices
`;
}

/**
 * Builds context about the specific quote being discussed.
 * Appended to the system prompt for a particular conversation.
 */
export function buildQuoteContext(ctx: QuoteContext): string {
  return `
## Current Quote Context
**Client:** ${ctx.client_name}
**Case Type:** ${ctx.case_type}
**Services:** ${ctx.services.join(", ")}
**Quoted Fee:** $${ctx.quoted_fee.toLocaleString()}
${ctx.is_floor_price ? "**Note:** This is already at floor pricing. Do NOT offer further discounts without flagging the attorney." : "**Note:** Standard pricing. Floor pricing available if client pushes back."}

Always reference this specific quote when closing. Get verbal agreement on price before sending engagement letter.
`;
}
