/**
 * Post-Connected follow-up draft generator.
 *
 * Generates the body (and subject for email) for each step of the 3-touch
 * follow-up sequence triggered when Garrison marks Connected without
 * immediately retaining. Uses the firm's voice doctrine so the message
 * reads like a thoughtful attorney follow-up, not a templated drip.
 *
 * Haiku, ~$0.001/draft. Caller logs to ai_jobs per CLAUDE.md #5.
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 500;

export interface FollowupDraftInput {
  step: 1 | 2 | 3;
  channel: "sms" | "email";
  firstName: string | null;
  matterType: string | null;
  descriptionSummary: string | null;
  attorneyFirstName: string;
  firmDisplayName: string;
  /** A short note Garrison may have captured during/after the call. */
  callContextNote: string | null;
  /** Firm voice doctrine, if configured. */
  voiceDoctrine: string | null;
  /** Public Google Appointments / Calendly link. When provided + the step
   *  is 2 or 3, the prompt is instructed to include it naturally as a
   *  booking option. Step 1 deliberately ignores it (too soon after the
   *  call — would read as the AI taking over the touchpoint). */
  calendarLink?: string | null;
}

export interface FollowupDraftResult {
  subject?: string;
  body: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  fellBack: boolean;
}

const STEP_INSTRUCTIONS: Record<1 | 2 | 3, string> = {
  1: `STEP 1 (~24h after the call). The lead and the attorney just spoke. This is a warm short follow-up that keeps momentum.
- Tone: friendly, present, action-oriented. NOT pushy.
- Reference that they spoke recently (don't claim specifics about what was said unless we have a call_context_note).
- Make the next step easy: a yes/no on whether they want to keep moving.
- SMS: 1-2 sentences. End with a clear question or invitation.
- DO NOT include a calendar / booking link in this step — it's too soon after the call and would read like the AI took over.`,
  2: `STEP 2 (~72h after the call). Lead hasn't replied to Step 1 (or hasn't moved). Gentle circle-back.
- Tone: thoughtful, not desperate. Acknowledge they're busy.
- Surface one concrete value-prop or next step.
- If a calendar booking link is provided in the facts, weave it in as ONE soft option ("if a quick call works easier than texting, you can grab a slot here: <link>"). Do NOT make it the whole message — they may still respond on the existing thread.
- Email: 3-4 short paragraphs. Subject line that doesn't feel salesy.`,
  3: `STEP 3 (~7 days after the call). Last touch in this sequence. The lead has been quiet — the calendar invite is the path of least friction now.
- Tone: low-pressure, professional, respectful. Frame as graceful close that leaves the door open.
- If a calendar booking link is provided in the facts, make it the PRIMARY call-to-action. Phrase like "the simplest way to lock in time is to grab a slot here: <link>". One clear next step.
- Make it easy to say "not now" without burning the relationship.
- Email: 3-4 short paragraphs. Subject like "Last note from {firm}".`,
};

const SYSTEM_BASE = `You write post-call follow-up messages on behalf of a law firm to a prospective client they recently spoke with. The message goes into an attorney review queue before it sends — so it MUST sound like the attorney's voice, not generic.

Compliance:
- Do NOT imply an attorney-client relationship pre-engagement ("your attorney", "your case", "your matter" are forbidden until they retain).
- NEVER include "Esq." or "Esquire".
- NEVER promise outcomes, dollar savings, or specific legal predictions.
- NEVER use em dashes or en dashes.
- NEVER trail off with "..." or "…".

Style:
- Premium, calm, emotionally intelligent, human. Conversational sophistication.
- Specific over generic. If we have a matterType or descriptionSummary, reference it briefly (don't quote intake verbatim).
- Reads like a thoughtful attorney note, not a template.

Output requirements:
- For SMS: just the body, plain text, complete thought.
- For email: subject line on the first line as "SUBJECT: <line>", blank line, then body. No signoff (the system appends one).`;

export async function generateFollowupDraft(
  input: FollowupDraftInput,
): Promise<FollowupDraftResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);

  const facts: string[] = [
    `Channel: ${input.channel.toUpperCase()}`,
    `Follow-up step: ${input.step} of 3`,
    `Attorney first name: ${input.attorneyFirstName}`,
    `Firm name: ${input.firmDisplayName}`,
  ];
  if (input.firstName) facts.push(`Prospect first name: ${input.firstName}`);
  if (input.matterType) facts.push(`Matter type: ${input.matterType}`);
  if (input.descriptionSummary)
    facts.push(`Matter summary: ${input.descriptionSummary}`);
  if (input.callContextNote)
    facts.push(`Note from the call (use to personalize): ${input.callContextNote.slice(0, 400)}`);
  // Only pass the calendar link for steps 2 + 3 — step 1 should never have it.
  if (input.calendarLink && (input.step === 2 || input.step === 3)) {
    facts.push(`Calendar booking link (include per step instructions): ${input.calendarLink}`);
  }

  let systemPrompt = SYSTEM_BASE + "\n\n" + STEP_INSTRUCTIONS[input.step];
  if (input.voiceDoctrine && input.voiceDoctrine.trim().length > 0) {
    systemPrompt += `\n\n## VOICE DOCTRINE\n${input.voiceDoctrine.trim()}`;
  }

  const client = new Anthropic();
  const start = performance.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolvedModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Write the follow-up using these facts:\n\n${facts.join("\n")}`,
        },
      ],
    });
  } catch (err) {
    console.error("[generateFollowupDraft] Anthropic failed:", err);
    return {
      body: fallbackBody(input),
      model: resolvedModel,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      latencyMs: Math.round(performance.now() - start),
      fellBack: true,
    };
  }
  const latencyMs = Math.round(performance.now() - start);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costCents = computeTokenCostCents(resolvedModel, inputTokens, outputTokens);

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    return {
      body: fallbackBody(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  let raw = text.text.trim();
  raw = raw.replace(/[–—]/g, ",");
  // Reject any trailing ellipsis as a final safety net.
  if (/(\.\.\.|…)\s*$/.test(raw)) {
    return {
      body: fallbackBody(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  let subject: string | undefined;
  let body = raw;
  if (input.channel === "email") {
    const match = raw.match(/^SUBJECT:\s*(.+?)\s*\n([\s\S]*)$/);
    if (match) {
      subject = match[1].trim();
      body = match[2].trim();
    }
  }

  return {
    subject,
    body,
    model: resolvedModel,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    fellBack: false,
  };
}

function fallbackBody(input: FollowupDraftInput): string {
  const first = input.firstName ?? "there";
  const linkLine =
    input.calendarLink && (input.step === 2 || input.step === 3)
      ? `\n\nIf a quick call is easier than texting back, you can grab a slot here: ${input.calendarLink}`
      : "";
  if (input.channel === "sms") {
    if (input.step === 1) {
      return `Hey ${first}, good catching up. Want to keep things moving when works for you?`;
    }
    if (input.step === 2) {
      return `Hey ${first}, circling back from the other day. Happy to send over what you need whenever timing's right.${linkLine}`;
    }
    return `${first}, last note from me on this. If timing isn't right, no worries at all; just let me know when you'd like to pick this back up.${linkLine}`;
  }
  // email
  return `Hi ${first},\n\nWanted to follow up briefly. Let me know if a quick step on next move would be helpful.${linkLine}\n\nBest,\n${input.attorneyFirstName}`;
}
