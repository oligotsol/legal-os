/**
 * Mass-blast draft generator.
 *
 * Garrison gives a short brief ("estate planning value reminder, no
 * urgency") + channel; we produce a personalizable starter (with
 * {first_name} token) in the firm's voice doctrine. Returns subject (for
 * email) + body.
 *
 * Haiku, ~$0.001/draft. Logs to ai_jobs.
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 600;

export interface BlastDraftInput {
  channel: "sms" | "email";
  /** Garrison's short intent — e.g. "estate planning value reminder, no urgency". */
  brief: string;
  /** Firm voice doctrine prompt body. Optional; falls back to generic tone. */
  voiceDoctrine?: string | null;
  /** Firm display name (e.g. "Legacy First Law"). */
  firmDisplayName: string;
  /** Attorney first name for natural reference. */
  attorneyFirstName?: string | null;
}

export interface BlastDraftResult {
  subject?: string;
  body: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  fellBack: boolean;
}

const SYSTEM_BASE = `You write mass-outreach messages on behalf of a law firm to a list of prospective clients. The user gives you a short brief; you produce a clean, personal-feeling message that will be sent to many recipients with simple token substitution at send time.

Mandatory rules:
- Use the token {first_name} where you'd normally type the recipient's first name. The system will replace it per-recipient at send time. Do NOT type a literal name.
- The {firm_name} token is also available if you want it; the system substitutes the firm name.
- Output PLAIN TEXT only. No markdown, no signoff blocks, no quoted responses.
- NEVER use em dashes or en dashes. Use commas or new sentences.
- NEVER include "Esq." or "Esquire".
- NEVER imply an attorney-client relationship (no "your attorney", "your case", "your matter"). Compliance: this is intake-side outreach, not retained-counsel communication.
- NEVER include outcome guarantees, legal predictions, or specific dollar promises.
- Do NOT use trailing ellipses or partial sentences. The message must end with a complete thought.

Channel-specific:
- SMS: 1-3 sentences. Aim for ~140 chars; OK to go slightly longer (multi-part). End with a question or clear invitation.
- Email: subject line + body. Body is 3-5 short paragraphs. No need for a signoff — the system appends one.

When email: emit subject as the first line, formatted exactly as:
SUBJECT: <subject text>

(blank line)

Then the body.

When SMS: emit only the body.`;

export async function generateBlastDraft(
  input: BlastDraftInput,
): Promise<BlastDraftResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);
  const facts: string[] = [
    `Channel: ${input.channel.toUpperCase()}`,
    `Firm name: ${input.firmDisplayName}`,
  ];
  if (input.attorneyFirstName)
    facts.push(`Attorney first name (for natural reference): ${input.attorneyFirstName}`);
  facts.push(`Brief from the firm: ${input.brief.trim()}`);

  let systemPrompt = SYSTEM_BASE;
  if (input.voiceDoctrine && input.voiceDoctrine.trim().length > 0) {
    systemPrompt += `\n\n## VOICE DOCTRINE (apply to this draft)\n${input.voiceDoctrine.trim()}`;
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
          content: `Write the message using these facts:\n\n${facts.join("\n")}\n\nRemember: end with a complete thought, no ellipses, use {first_name} for personalization.`,
        },
      ],
    });
  } catch (err) {
    console.error("[generateBlastDraft] Anthropic failed:", err);
    return {
      body: deterministicFallback(input),
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
      body: deterministicFallback(input),
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

  // Parse SUBJECT: <line> for email mode.
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

function deterministicFallback(input: BlastDraftInput): string {
  if (input.channel === "sms") {
    return `Hi {first_name}, ${input.attorneyFirstName ?? "the team"} at ${input.firmDisplayName} here. Wanted to follow up on your inquiry. What's the best way to get in touch?`;
  }
  return `Hi {first_name},

I wanted to follow up on your inquiry. We're happy to help you take the next step whenever you're ready.

Let me know if a quick conversation would be helpful, or if there's anything I can clarify for you.

Best,
${input.attorneyFirstName ?? "The team"} at ${input.firmDisplayName}`;
}
