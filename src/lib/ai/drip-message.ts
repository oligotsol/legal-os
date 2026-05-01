/**
 * AI-generated drip follow-up messages.
 *
 * Uses the conversation AI to generate personalized follow-up messages
 * at Day 2/5/7/10 cadence instead of static templates.
 */

import { converse } from "@/lib/ai/converse";
import type {
  ConversationConfig,
  ConversationContext,
  PromptMessage,
} from "@/lib/ai/prompts/converse";

// Day-specific instructions for AI drip messages
export const DRIP_DAY_INSTRUCTIONS: Record<number, string> = {
  2: "Day 2 gentle check-in. Reference their specific matter. Brief and warm.",
  5: "Day 5. Share scheduling link and flat fee value prop. Slightly more assertive.",
  7: "Day 7. Direct ask: still interested? Respect their time. One CTA.",
  10: "FINAL follow-up. Ball in their court. No pressure. Warm close.",
};

export interface DripMessageInput {
  firmId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactState: string | null;
  matterType: string | null;
  conversationId: string;
  dayNumber: number;
  config: ConversationConfig;
  history: PromptMessage[];
}

export interface DripMessageResult {
  message: string;
  channel: "sms" | "email";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

/**
 * Generate a personalized AI drip follow-up message.
 */
export async function generateDripMessage(
  input: DripMessageInput,
): Promise<DripMessageResult> {
  const dayInstruction =
    DRIP_DAY_INSTRUCTIONS[input.dayNumber] ?? DRIP_DAY_INSTRUCTIONS[10];

  const context: ConversationContext = {
    conversationId: input.conversationId,
    phase: "follow_up",
    channel: "sms",
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    contactState: input.contactState,
    matterType: input.matterType,
    classificationConfidence: null,
    classificationSignals: null,
    messageCount: input.history.length,
    conversationContext: { dripDay: input.dayNumber },
  };

  const syntheticMessage = `[System: Generate a Day ${input.dayNumber} follow-up message. ${dayInstruction}]`;

  const result = await converse(
    input.config,
    context,
    input.history,
    syntheticMessage,
  );

  // Post-process: sanitize the message
  const sanitized = sanitizeDripMessage(
    result.response.reply,
    input.config.bannedPhrases,
    input.config.smsCharLimit,
    input.contactState,
    input.config.perJurisdictionSignOffs,
    result.response.suggested_channel,
  );

  return {
    message: sanitized,
    channel: result.response.suggested_channel,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costCents: result.costCents,
  };
}

/**
 * Sanitize a drip message:
 * 1. Remove banned phrases
 * 2. Truncate SMS at sentence boundary
 * 3. Append correct sign-off
 */
export function sanitizeDripMessage(
  message: string,
  bannedPhrases: string[],
  smsCharLimit: number,
  contactState: string | null,
  signOffs: Record<string, { sms: string; email: string }>,
  channel: "sms" | "email",
): string {
  let result = message;

  // 1. Remove banned phrases (case-insensitive)
  for (const phrase of bannedPhrases) {
    const regex = new RegExp(
      phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    result = result
      .replace(regex, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // 2. Determine sign-off
  const signOffKey =
    contactState && signOffs[contactState]
      ? contactState
      : Object.keys(signOffs)[0];
  const signOff = signOffKey ? (signOffs[signOffKey]?.[channel] ?? "") : "";

  // 3. If sign-off is not already present, append it
  if (signOff && !result.endsWith(signOff)) {
    // Remove any existing trailing sign-off pattern (e.g. "— Name")
    result = result.replace(/\s*—\s*\S+[\s\S]*$/, "").trim();
    result = result + "\n" + signOff;
  }

  // 4. SMS truncation at sentence boundary
  if (channel === "sms" && result.length > smsCharLimit) {
    const truncated = result.slice(0, smsCharLimit);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf("! "),
      truncated.lastIndexOf("? "),
      truncated.lastIndexOf(".\n"),
      truncated.lastIndexOf("!\n"),
      truncated.lastIndexOf("?\n"),
    );

    if (lastSentenceEnd > 0) {
      result = result.slice(0, lastSentenceEnd + 1);
    } else {
      const lastSpace = truncated.lastIndexOf(" ");
      if (lastSpace > smsCharLimit * 0.5) {
        result = result.slice(0, lastSpace) + "...";
      } else {
        result = result.slice(0, smsCharLimit - 3) + "...";
      }
    }
    // Re-append sign-off if it got truncated
    if (signOff && !result.includes(signOff)) {
      const maxBody = smsCharLimit - signOff.length - 1;
      if (result.length > maxBody) {
        const bodyTruncated = result.slice(0, maxBody);
        const lastPeriod = Math.max(
          bodyTruncated.lastIndexOf(". "),
          bodyTruncated.lastIndexOf(".\n"),
        );
        result =
          lastPeriod > 0
            ? bodyTruncated.slice(0, lastPeriod + 1)
            : bodyTruncated;
      }
      result = result.trim() + "\n" + signOff;
    }
  }

  return result.trim();
}
