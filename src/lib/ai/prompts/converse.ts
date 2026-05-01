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
 * Build the full conversation prompt (system string + message turns).
 */
export function buildConversationPrompt(
  config: ConversationConfig,
  context: ConversationContext,
  history: PromptMessage[],
  newMessage: string,
): ConversationPrompt {
  const sections: string[] = [];

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
