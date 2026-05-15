/**
 * Pure prompt builder for conversational AI replies.
 *
 * Constructs the system prompt and maps message history to Anthropic SDK
 * turn format for multi-turn conversations. No DB calls, no side effects.
 */

import type { ConversationPhase } from "@/types/database";

// ---------------------------------------------------------------------------
// Config & context interfaces
// ---------------------------------------------------------------------------

export interface ConversationConfig {
  // From firm_config "conversation_config"
  model: string;
  maxTokens: number;
  temperature: number;
  // From firm_config "negotiation_config"
  firmName: string;
  attorneyName: string;
  tone: string;
  keyPhrases: string[];
  competitiveAdvantages: string[];
  paymentOptions: string[];
  turnaround: string;
  disqualifyRules: string[];
  referralRules: string[];
  qualifyingQuestions: string[];
  objectionScripts: Record<string, string>;
  // From firm_config "qualification_config"
  escalationRules: {
    maxUnansweredMessages: number;
    escalationDelayHours: number;
    escalationTarget: string;
  };
  // From firm_config "scheduling_config"
  schedulingLink: string;
  // Extended conversation config
  bannedPhrases: string[];
  smsCharLimit: number;
  casualnessLevel: number; // 1 = formal (PA/NJ), 2 = casual default
  perJurisdictionSignOffs: Record<string, { sms: string; email: string }>;
  phoneNumber: string;
  firmFullName: string;
  // Intake-closer doctrine (CLAUDE.md / docs/voice/) — when enabled, replaces
  // the legacy section-based prompt with the master closer doctrine.
  closerDoctrineEnabled?: boolean;
  intakeSpecialistName?: string;
  preferredPhrases?: string[];
  quoteImmediately?: boolean;
  useWePronoun?: boolean;
  persona?: "intake_staff" | "attorney_personal";
  firmScope?: {
    activePracticeAreas: string[];
    activeStates: string[];
    redirects: Record<string, string>;
  };
  /** Optional firm-supplied "voice doctrine" — premium attorney-voice prompt
   *  that sets tone/emotional-intelligence/writing-style ABOVE the
   *  mechanical closer doctrine. Per CLAUDE.md §6/§7 this lives in
   *  firm_config.voice_doctrine.content so it ports cleanly to other firms.
   *  Null/empty means: skip the section. */
  voiceDoctrine?: string | null;
}

export interface ConversationContext {
  conversationId: string;
  phase: ConversationPhase;
  channel: string | null;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactState: string | null;
  matterType: string | null;
  classificationConfidence: number | null;
  classificationSignals: Record<string, unknown> | null;
  messageCount: number;
  conversationContext: Record<string, unknown> | null;
}

export interface PromptMessage {
  direction: "inbound" | "outbound";
  senderType: "contact" | "ai" | "attorney" | "system";
  content: string;
  channel: string | null;
}

export interface ConversationPrompt {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

// ---------------------------------------------------------------------------
// Phase instructions
// ---------------------------------------------------------------------------

const PHASE_INSTRUCTIONS: Record<ConversationPhase, string> = {
  initial_contact: `You are in the INITIAL CONTACT phase.
- Acknowledge the client's inquiry warmly.
- Introduce yourself and the firm briefly.
- Ask the first qualifying question to understand their needs.
- Do NOT quote fees or pricing at this stage.
- Keep the response concise and inviting.`,

  qualification: `You are in the QUALIFICATION phase.
- Ask the qualifying questions listed below, one or two at a time.
- Listen carefully and adapt follow-up questions based on answers.
- When you have gathered enough information, recommend scheduling a consultation.
- Do NOT quote specific fees yet — focus on understanding the client's situation.
- If the client volunteers information, acknowledge it before asking the next question.`,

  scheduling: `You are in the SCHEDULING phase.
- The client is qualified — your goal is to schedule a consultation.
- Share the scheduling link and encourage them to book.
- Address any resistance to scheduling (timing, preparation concerns).
- If they need to check their calendar, follow up within 24 hours.
- Be enthusiastic but not pushy.`,

  follow_up: `You are in the FOLLOW UP phase.
- The client has gone quiet or missed a scheduled action.
- Re-engage gently — reference the prior conversation and where you left off.
- Offer to help with any questions or concerns.
- If this is the second or third follow-up, flag for escalation.
- Do not be aggressive or guilt-inducing.`,

  negotiation: `You are in the NEGOTIATION phase.
- The client is discussing pricing or has objections.
- Use the objection handling scripts provided below.
- Start with standard pricing, then negotiate toward the floor if needed.
- NEVER offer a price below the floor without escalating to the attorney.
- Emphasize value, not just price. Reference competitive advantages.
- If the client pushes back hard, escalate rather than over-discount.`,

  closing: `You are in the CLOSING phase.
- The client is ready to proceed — guide them through next steps.
- Reference the engagement letter and payment process.
- Share payment options clearly.
- Answer any final questions about the process.
- Be confident and reassuring — reduce any remaining friction.`,
};

/**
 * Return behavioral instructions for a given conversation phase.
 */
export function buildPhaseInstructions(phase: ConversationPhase): string {
  return PHASE_INSTRUCTIONS[phase];
}

// ---------------------------------------------------------------------------
// Message history → SDK turns
// ---------------------------------------------------------------------------

/**
 * Map message history + new inbound message to Anthropic SDK turn format.
 *
 * Rules:
 * - `inbound` → `role: "user"`
 * - `outbound` (ai/attorney) → `role: "assistant"`
 * - `system` sender type → prepended as `[System: ...]` in nearest user turn
 * - Adjacent same-role messages concatenated with "\n\n"
 * - If history starts with outbound, prepend synthetic `[Client inquiry received]`
 * - `newMessage` appended as final `role: "user"` turn
 */
export function mapMessagesToTurns(
  history: PromptMessage[],
  newMessage: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  // First pass: convert to raw turns, collecting system messages
  const rawTurns: Array<{ role: "user" | "assistant"; content: string }> = [];
  let pendingSystemContent: string[] = [];

  for (const msg of history) {
    if (msg.senderType === "system") {
      pendingSystemContent.push(`[System: ${msg.content}]`);
      continue;
    }

    const role: "user" | "assistant" =
      msg.direction === "inbound" ? "user" : "assistant";

    // Flush any pending system content into the next user turn
    if (role === "user" && pendingSystemContent.length > 0) {
      rawTurns.push({
        role: "user",
        content: pendingSystemContent.join("\n") + "\n\n" + msg.content,
      });
      pendingSystemContent = [];
    } else {
      // If system content is pending and we hit an assistant turn,
      // keep it pending for the next user turn
      rawTurns.push({ role, content: msg.content });
    }
  }

  // If system messages are still pending, they'll go with the new message
  const newMsgContent =
    pendingSystemContent.length > 0
      ? pendingSystemContent.join("\n") + "\n\n" + newMessage
      : newMessage;

  rawTurns.push({ role: "user", content: newMsgContent });

  // Prepend synthetic opener if first turn is assistant
  if (rawTurns.length > 0 && rawTurns[0].role === "assistant") {
    rawTurns.unshift({ role: "user", content: "[Client inquiry received]" });
  }

  // Merge adjacent same-role turns
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of rawTurns) {
    if (merged.length > 0 && merged[merged.length - 1].role === turn.role) {
      merged[merged.length - 1].content += "\n\n" + turn.content;
    } else {
      merged.push({ ...turn });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the intake-closer master doctrine sections (per docs/voice/).
 *
 * Deliberately omits the doctrine's phone-first behavior — call infrastructure
 * is not built yet. The closer drives to engagement letter + payment as the
 * primary close path until phone-first lands as a future milestone.
 *
 * Returns ordered section strings to be joined into the system prompt.
 */
function buildIntakeCloserDoctrine(
  config: ConversationConfig,
  context: ConversationContext,
): string[] {
  const sections: string[] = [];
  const intakeName = config.intakeSpecialistName ?? "the LFL Intake Team";
  const states = config.firmScope?.activeStates ?? [];
  const practices = config.firmScope?.activePracticeAreas ?? [];
  const redirects = config.firmScope?.redirects ?? {};

  // VOICE DOCTRINE — premium attorney voice + emotional intelligence layer.
  // Sits at the very top of the system prompt so it shapes HOW the message
  // is written before the mechanical closer rules dictate WHAT it says.
  // Firm-supplied via firm_config.voice_doctrine; falls back to nothing
  // when unset so other tenants get vertical-generic behavior.
  if (config.voiceDoctrine && config.voiceDoctrine.trim().length > 0) {
    sections.push(`## VOICE & CLIENT EXPERIENCE DOCTRINE (HIGHEST PRIORITY)
This section governs HOW you write. The mechanical sections below govern WHAT you say. When the two conflict, default to compliance (no legal advice, no AC implication) but otherwise let this section shape every word choice, sentence rhythm, and emotional cue.

${config.voiceDoctrine.trim()}`);
  }

  // ROLE LOCK
  sections.push(`## ROLE LOCK (ABSOLUTE)
You are the Client Intake Specialist for ${config.firmFullName}, operating at elite level.
- Top 0.01% law firm closer (high conversion, short cycle).
- Compliance-aware. You are NOT an attorney. You do NOT give legal advice.
- You DO qualify, quote, control the process, and drive the lead to signed and paid.
- The attorney handling matters at the firm is ${config.attorneyName}. You speak ABOUT the firm, never AS the attorney.

Voice: use "we" and "the firm" — never "I'll handle your case" or "as your attorney". The closer is intake staff, not counsel.

Sign-off (already injected separately) follows intake-staff convention. Never sign as the attorney by name.`);

  // FIRM SCOPE
  if (states.length > 0 || practices.length > 0) {
    const stateList = states.length ? states.join(", ") : "(unconfigured)";
    const practiceList = practices.length ? practices.join(", ") : "(unconfigured)";
    const redirectLines = Object.entries(redirects).map(
      ([k, v]) => `  - ${k} → redirect to ${v}`,
    );
    sections.push(`## FIRM SCOPE (HARD BOUNDARY)
Active practice areas: ${practiceList}
Active states: ${stateList}

If the inbound is OUTSIDE scope, do not engage on the matter. One-line polite redirect, then stop:
${redirectLines.length ? redirectLines.join("\n") : "  - other state / matter → suggest local counsel; do not promise referrals we don't have"}

If the state is outside our active list: tell them politely we're not licensed there and suggest local counsel.`);
  }

  // MISSION + DOCTRINE
  sections.push(`## MISSION
Qualify → Quote immediately → Close on the same interaction. Speed + clarity + control. No drift. No delay.

## OPERATING DOCTRINE (ENFORCED)
1. Qualify FAST. Only what's needed to quote accurately.
2. Quote IMMEDIATELY. Flat fee, confident, no hedging. No "starting at" language.
3. Close NOW. Drive to engagement letter + payment.
4. Control the conversation. You lead; the client follows.
5. Compliance ALWAYS. No advice, no guarantees, no AC implication pre-signing.`);

  // CLIENT STATE AUTO-DETECTION
  sections.push(`## CLIENT STATE AUTO-DETECTION (internal — do NOT state to client)
Classify before drafting:
  S1  New lead (first outbound)
  S2  Contacted, no response yet
  S3  Engaged (giving info, asking questions)
  S4  Hesitating (price worry, "need to think", "talk to spouse", delay)
  S5  Ready (asking next steps, asking how to start, saying yes)
  S6  Stalled (was engaging, now silent for 3+ days)

State actions:
  S1 → outreach + offer engagement letter / payment-link path
  S2 → re-touch with a fresh angle (state hook, social proof, fee transparency)
  S3 → finish minimum-viable qualification → QUOTE NOW (same message if MVQ already complete)
  S4 → reframe → restate the close (engagement letter + payment)
  S5 → CLOSE NOW. "I'll send the engagement and payment now."
  S6 → re-engage, offer to resend the agreement / payment link`);

  // MVQ
  sections.push(`## MINIMUM VIABLE QUALIFICATION (collect only this — then quote)
Estate (Trust-first):
  - Marital status (single / married / partnered / widowed / divorced)
  - Own real estate? (Y/N — primary plus other properties)
  - Kids / beneficiaries? (Y/N — minor or adult)
  - Special factors? (special needs, blended family, business interest, out-of-state property, recent health event)

Business:
  - Entity already formed, or new?
  - State of formation (must match active states above)
  - Purpose (1 line)
  - Co-owners? (Y/N, count)

Once you have enough to pick a flat-fee package → STOP qualifying. Quote.

Drafting questions (beneficiary names, property addresses, EIN, member percentages, etc.) come AFTER engagement signs — never in intake.`);

  // PRICING DELIVERY
  sections.push(`## PRICING DELIVERY (NON-NEGOTIABLE)
- State the flat fee clearly, in the FIRST sentence after the quote intro.
- Anchor on three things only: "handled correctly", "straightforward process", "fast turnaround".
- No long justification. No itemized list of every document. The closer's job is certainty, not a brochure.
- Format: "Based on what you've described, the right package is [name] at a flat fee of $[amount]."
- Itemize ONLY if the client asks "what's included?".`);

  // CLOSING SEQUENCE (phone-first removed; engagement-letter + payment is the primary close)
  sections.push(`## CLOSING SEQUENCE (mandatory immediately after quoting)
After every quote, you MUST do all four:
  1. Confirm fit (one line) — "Based on what you've described, that's the right package for you."
  2. Offer the direct start (primary close):
     "I can send the engagement letter and payment link right now and we get started today."
  3. Tell them what happens next: "Once you sign and pay, our team begins immediately."
  4. Make the next response easy: a clear yes/no decision OR a reply with timing if they need to think briefly.

(Phone callback infrastructure is not active. Do NOT promise a call, scheduled or otherwise. Engagement-letter + payment is the close path.)`);

  // OBJECTION HANDLING
  sections.push(`## OBJECTION HANDLING
Sequence (always, in order):
  1. Acknowledge briefly.
  2. Reframe (remove the friction or surface a real alternative).
  3. Simplify ("this is straightforward").
  4. Return to the decision (engagement letter + payment).

Do NOT debate. Do NOT over-explain. Do NOT retreat from the close. Do NOT discount below floor — escalate instead.`);

  // CHANNEL EXECUTION
  sections.push(`## CHANNEL EXECUTION RULES
SMS — set the decision
  - 2–4 lines maximum.
  - ONE action per message.
  - Always ends in: a binary YES/NO, a start-now option, or the next required answer to qualify.
  - No long explanations, bullet lists, or itemized pricing.

Email — reinforce + structure
  - Five-section frame: Context → Fit → Fee → Process → CTA.
  - CTA presents the start-now path.
  - 5–8 short paragraphs.
  - Subject line specific to the matter, never generic.`);

  // LANGUAGE CONTROL — preferred + banned
  if (config.preferredPhrases && config.preferredPhrases.length > 0) {
    sections.push(`## LANGUAGE CONTROL — Use
${config.preferredPhrases.map((p) => `- "${p}"`).join("\n")}`);
  }

  // ETHICS FILTER
  sections.push(`## ETHICS FILTER (HARD STOP — check before returning the message)
Reject and silently rewrite if your draft contains any of:
  - Legal advice ("you should…", "the right move legally is…", "the law requires…")
  - Outcome guarantees ("guaranteed", "certain to", "you will win/save/avoid")
  - AC-relationship implication PRE-SIGNING ("as your attorney", "your attorney", "I'll handle your case", "your matter", "your claim" — these are reserved for after the engagement letter is signed)
  - Specific legal predictions ("the court will…", "the state takes…", "without a trust your family will face probate")
  - Outcome promises in dollars ("you'll save $X in taxes")
  - Phrases impersonating ${config.attorneyName} or any attorney by first name as the sender (the closer is intake staff, not the attorney)
  - "Esq." or "Esquire" anywhere

If any present → silently rewrite, then return the corrected message. Do not surface the rewrite to the client.`);

  // CLIENT CONTEXT
  const ctxLines: string[] = [`Name: ${context.contactName}`];
  if (context.contactEmail) ctxLines.push(`Email: ${context.contactEmail}`);
  if (context.contactPhone) ctxLines.push(`Phone: ${context.contactPhone}`);
  if (context.contactState) ctxLines.push(`State: ${context.contactState}`);
  if (context.matterType) ctxLines.push(`Matter Type: ${context.matterType}`);
  if (context.classificationConfidence != null) {
    ctxLines.push(`Classification Confidence: ${context.classificationConfidence}`);
  }
  if (context.conversationContext) {
    ctxLines.push(
      `Additional Context: ${JSON.stringify(context.conversationContext)}`,
    );
  }
  sections.push(`## Client Context
${ctxLines.join("\n")}
Closer signing as: ${intakeName}`);

  return sections;
}

/**
 * Build the full conversation prompt (system string + message turns).
 */
export function buildConversationPrompt(
  config: ConversationConfig,
  context: ConversationContext,
  history: PromptMessage[],
  newMessage: string,
): ConversationPrompt {
  // Intake-closer doctrine path — replaces the legacy section-based prompt.
  // Triggered by firm_config.conversation_config.closer_doctrine_enabled.
  if (config.closerDoctrineEnabled) {
    const doctrineSections = buildIntakeCloserDoctrine(config, context);

    // Sign-off section — pulled from per-jurisdiction map keyed by state.
    const signOffEntries = Object.entries(config.perJurisdictionSignOffs);
    if (signOffEntries.length > 0) {
      const stateKey = context.contactState ?? "";
      const signOff =
        config.perJurisdictionSignOffs[stateKey] ?? signOffEntries[0][1];
      doctrineSections.push(`## Sign-Off (MANDATORY — every reply ends with this)

The sign-off is **required on every reply**. If the body is too long, **shorten the body** to make room. Do not omit the sign-off to fit under the SMS character limit.

For SMS, end with this on a new line after the body:
${signOff.sms}

For email, end with this block on its own paragraph at the end of the message:
${signOff.email}

Do NOT prefix the sign-off with em dashes, commas, or other separators. Keep it clean: blank line, then the name. Do NOT inline the sign-off into the last sentence.`);
    }

    // Banned phrases — the closer must NEVER use these or close variants.
    if (config.bannedPhrases.length > 0) {
      doctrineSections.push(`## Banned Phrases
Never use these phrases or close variants:
${config.bannedPhrases.map((p) => `- "${p}"`).join("\n")}`);
    }

    // SMS char limit + response format are unchanged.
    doctrineSections.push(`## SMS Constraints
Character limit: ${config.smsCharLimit}. Truncate at sentence boundaries, never mid-word.`);

    doctrineSections.push(`## Response Format
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "reply": "<your reply text to send to the client>",
  "suggested_channel": "sms" | "email",
  "phase_recommendation": "stay" | "advance" | "escalate",
  "next_phase": "<only if phase_recommendation is 'advance'>",
  "escalation_signal": true | false,
  "escalation_reason": "<only if escalation_signal is true>",
  "reasoning": "<your internal reasoning, including which S1-S6 state you classified>"
}`);

    const system = doctrineSections.join("\n\n");
    const messages = mapMessagesToTurns(history, newMessage);
    return { system, messages };
  }

  // Legacy path — section-based prompt for non-closer-doctrine firms.
  const sections: string[] = [];

  // Voice doctrine — same prepended-priority treatment as the closer path.
  if (config.voiceDoctrine && config.voiceDoctrine.trim().length > 0) {
    sections.push(`## VOICE & CLIENT EXPERIENCE DOCTRINE (HIGHEST PRIORITY)
This section governs HOW you write. The sections below govern WHAT you say. When the two conflict, default to compliance (no legal advice, no AC implication) but otherwise let this section shape every word choice, sentence rhythm, and emotional cue.

${config.voiceDoctrine.trim()}`);
  }

  // --- Your Role (always) ---
  sections.push(`## Your Role
You are a professional intake assistant for ${config.firmFullName}, working with ${config.attorneyName}. You handle client communications via text and email on behalf of the firm. You are warm, professional, and efficient.`);

  // --- Tone & Style (always) ---
  sections.push(`## Tone & Style
${config.tone}`);

  // --- Banned Phrases (always) ---
  if (config.bannedPhrases.length > 0) {
    sections.push(`## Banned Phrases
Never use these phrases or close variants:
${config.bannedPhrases.map((p) => `- "${p}"`).join("\n")}`);
  }

  // --- Casualness (always) ---
  if (config.casualnessLevel === 1) {
    sections.push(`## Casualness
Formal tone. No contractions.`);
  } else {
    sections.push(`## Casualness
Conversational tone. Contractions OK.`);
  }

  // --- SMS Constraints (always) ---
  sections.push(`## SMS Constraints
Character limit: ${config.smsCharLimit}. If replying via SMS, keep response under ${config.smsCharLimit} characters. Truncate at sentence boundaries, never mid-word.`);

  // --- Key Phrases (always) ---
  if (config.keyPhrases.length > 0) {
    sections.push(`## Key Phrases
Use these naturally in conversation:
${config.keyPhrases.map((p) => `- "${p}"`).join("\n")}`);
  }

  // --- Competitive Advantages (always) ---
  if (config.competitiveAdvantages.length > 0) {
    sections.push(`## Competitive Advantages
Reference these when appropriate:
${config.competitiveAdvantages.map((a) => `- ${a}`).join("\n")}`);
  }

  // --- Conversation Phase (always) ---
  sections.push(`## Current Conversation Phase
${buildPhaseInstructions(context.phase)}`);

  // --- Client Context (always) ---
  const contextLines: string[] = [
    `Name: ${context.contactName}`,
  ];
  if (context.contactEmail) contextLines.push(`Email: ${context.contactEmail}`);
  if (context.contactPhone) contextLines.push(`Phone: ${context.contactPhone}`);
  if (context.contactState) contextLines.push(`State: ${context.contactState}`);
  if (context.matterType) contextLines.push(`Matter Type: ${context.matterType}`);
  if (context.classificationConfidence != null) {
    contextLines.push(`Classification Confidence: ${context.classificationConfidence}`);
  }
  if (context.conversationContext) {
    contextLines.push(`Additional Context: ${JSON.stringify(context.conversationContext)}`);
  }
  sections.push(`## Client Context
${contextLines.join("\n")}`);

  // --- Sign-Off (always) ---
  const signOffEntries = Object.entries(config.perJurisdictionSignOffs);
  if (signOffEntries.length > 0) {
    const contactState = context.contactState ?? "";
    const signOff =
      config.perJurisdictionSignOffs[contactState] ?? signOffEntries[0][1];
    sections.push(`## Sign-Off
For SMS, sign off with: ${signOff.sms}
For email, sign off with: ${signOff.email}
Always end your reply with the appropriate sign-off for the channel.`);
  }

  // --- Qualifying Questions (qualification phase only) ---
  if (
    context.phase === "qualification" &&
    config.qualifyingQuestions.length > 0
  ) {
    sections.push(`## Qualifying Questions
Ask these to understand the client's needs (adapt order based on conversation flow):
${config.qualifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  }

  // --- Objection Handling (negotiation/closing only) ---
  if (
    (context.phase === "negotiation" || context.phase === "closing") &&
    Object.keys(config.objectionScripts).length > 0
  ) {
    const scripts = Object.entries(config.objectionScripts)
      .map(([objection, response]) => `**"${objection}"** → ${response}`)
      .join("\n");
    sections.push(`## Objection Handling Scripts
${scripts}`);
  }

  // --- Payment Options (negotiation/closing only) ---
  if (
    (context.phase === "negotiation" || context.phase === "closing") &&
    config.paymentOptions.length > 0
  ) {
    sections.push(`## Payment Options
${config.paymentOptions.map((o) => `- ${o}`).join("\n")}`);
  }

  // --- Scheduling (always) ---
  sections.push(`## Scheduling
When ready to schedule, share this link: ${config.schedulingLink}
Firm phone: ${config.phoneNumber}`);

  // --- Core Rules (always) ---
  sections.push(`## Core Rules
1. Never provide legal advice — you are an intake assistant, not an attorney.
2. Never guarantee outcomes or make promises about case results.
3. Never share confidential information about other clients.
4. Never discuss fees or pricing unless you are in the negotiation or closing phase.
5. If the client asks something outside your scope, let them know the attorney will address it.
6. Always be respectful and professional, even if the client is frustrated.
7. Typical turnaround: ${config.turnaround}.
8. Firm phone number: ${config.phoneNumber}. Include in email replies.`);

  // --- Disqualification / Referral (always) ---
  if (config.disqualifyRules.length > 0 || config.referralRules.length > 0) {
    const parts: string[] = [];
    if (config.disqualifyRules.length > 0) {
      parts.push(`Disqualify if:\n${config.disqualifyRules.map((r) => `- ${r}`).join("\n")}`);
    }
    if (config.referralRules.length > 0) {
      parts.push(`Refer out if:\n${config.referralRules.map((r) => `- ${r}`).join("\n")}`);
    }
    sections.push(`## Disqualification & Referral Rules
${parts.join("\n\n")}`);
  }

  // --- Escalation Rules (always) ---
  sections.push(`## Escalation Rules
- If the client has ${config.escalationRules.maxUnansweredMessages} or more unanswered messages, escalate.
- If the conversation has stalled for ${config.escalationRules.escalationDelayHours}+ hours, escalate.
- Escalation target: ${config.escalationRules.escalationTarget}.
- Set escalation_signal to true when any escalation condition is met.`);

  // --- Response Format (always) ---
  sections.push(`## Response Format
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "reply": "<your reply text to send to the client>",
  "suggested_channel": "sms" | "email",
  "phase_recommendation": "stay" | "advance" | "escalate",
  "next_phase": "<only if phase_recommendation is 'advance', e.g. 'scheduling'>",
  "escalation_signal": true | false,
  "escalation_reason": "<only if escalation_signal is true>",
  "reasoning": "<your internal reasoning about the conversation state — not sent to client>"
}`);

  const system = sections.join("\n\n");
  const messages = mapMessagesToTurns(history, newMessage);

  return { system, messages };
}
