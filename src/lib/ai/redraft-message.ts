/**
 * AI redraft — rewrites an existing message draft given attorney instructions
 * ("make it shorter", "less formal", "ask about marital status instead").
 *
 * Stays under the lib/ai abstraction per CLAUDE.md non-negotiable #5; every
 * call still logs to ai_jobs via the caller. Em/en-dashes are scrubbed from
 * the output (banned per [[feedback_no_em_dashes]] / Garrison's style rule).
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "sonnet";

export class RedraftError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RedraftError";
  }
}

export interface RedraftInput {
  /** The existing draft the attorney wants revised. */
  currentDraft: string;
  /** The attorney's free-text instructions for what to change. */
  instructions: string;
  /** Channel — used to keep SMS short. */
  channel: "sms" | "email" | null;
  /** Firm-level config to keep tone/banned-phrase consistency. */
  firmName?: string;
  attorneyName?: string;
  tone?: string;
  bannedPhrases?: string[];
  signOff?: string;
  smsCharLimit?: number;
  /** Optional model alias / id. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface RedraftResult {
  reply: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  model: string;
}

function scrubBannedPunctuation(s: string): string {
  return s.replace(/[–—]/g, ",").replace(/ ,/g, ",");
}

export async function redraftMessage(input: RedraftInput): Promise<RedraftResult> {
  const resolvedModel = resolveModelId(input.model ?? DEFAULT_MODEL);

  const charLimitNote =
    input.channel === "sms"
      ? `Stay under ${input.smsCharLimit ?? 300} characters; one or two sentences.`
      : "Keep the message concise and professional.";

  const bannedNote =
    input.bannedPhrases && input.bannedPhrases.length > 0
      ? `Avoid these phrases: ${input.bannedPhrases.map((p) => `"${p}"`).join(", ")}.`
      : "";

  const system = [
    `You are revising an outbound ${input.channel ?? "client"} message draft for ${input.firmName ?? "a law firm"}.`,
    input.attorneyName
      ? `The attorney of record is ${input.attorneyName}.`
      : "",
    input.tone ? `Tone: ${input.tone}.` : "",
    "Never use em dashes (—) or en dashes (–). Use commas, periods, or a new sentence instead.",
    bannedNote,
    charLimitNote,
    "Output only the revised message text — no preamble, no explanation, no quotes around it.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    "Here is the current draft:",
    "",
    "---",
    input.currentDraft,
    "---",
    "",
    "The attorney wants the following changes:",
    input.instructions,
    "",
    input.signOff
      ? `If a sign-off is appropriate, end the message with: ${input.signOff}`
      : "",
    "Revised draft:",
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic();
  const start = performance.now();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolvedModel,
      max_tokens: input.maxTokens ?? 600,
      temperature: input.temperature ?? 0.7,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (err) {
    throw new RedraftError(
      `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const latencyMs = Math.round(performance.now() - start);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costCents = computeTokenCostCents(resolvedModel, inputTokens, outputTokens);

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new RedraftError("No text content in API response");
  }

  const reply = scrubBannedPunctuation(textBlock.text.trim());

  return {
    reply,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    model: resolvedModel,
  };
}
