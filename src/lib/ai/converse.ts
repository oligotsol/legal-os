/**
 * Conversational AI reply generation — second Anthropic SDK caller.
 *
 * Takes a conversation's message history plus a new inbound message,
 * returns a structured draft reply for attorney review.
 *
 * Does NOT write to DB — caller is responsible for persisting to
 * `messages` and `ai_jobs`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  buildConversationPrompt,
  type ConversationConfig,
  type ConversationContext,
  type PromptMessage,
} from "./prompts/converse";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "sonnet";

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

export const ConverseResponseSchema = z.object({
  reply: z.string().min(1),
  suggested_channel: z.enum(["sms", "email"]),
  phase_recommendation: z.enum(["stay", "advance", "escalate"]),
  next_phase: z.string().nullish(),
  escalation_signal: z.boolean(),
  escalation_reason: z.string().nullish(),
  reasoning: z.string(),
});

export type ConverseResponse = z.infer<typeof ConverseResponseSchema>;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ConverseResult {
  response: ConverseResponse;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ConversationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

// ---------------------------------------------------------------------------
// SDK caller
// ---------------------------------------------------------------------------

/**
 * Generate an AI reply for a conversation.
 *
 * @param config - Merged firm-level conversation config
 * @param context - Current conversation state
 * @param history - Prior messages in the conversation
 * @param newMessage - The new inbound message to respond to
 * @param modelOverride - Optional model alias or full ID
 * @returns ConverseResult with structured response + observability fields
 */
export async function converse(
  config: ConversationConfig,
  context: ConversationContext,
  history: PromptMessage[],
  newMessage: string,
  modelOverride?: string,
): Promise<ConverseResult> {
  const resolvedModel = resolveModelId(modelOverride ?? config.model ?? DEFAULT_MODEL);
  const prompt = buildConversationPrompt(config, context, history, newMessage);

  const client = new Anthropic();
  const start = performance.now();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolvedModel,
      max_tokens: config.maxTokens ?? 1024,
      temperature: config.temperature ?? 0.7,
      system: prompt.system,
      messages: prompt.messages,
    });
  } catch (err) {
    throw new ConversationError(
      `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const latencyMs = Math.round(performance.now() - start);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costCents = computeTokenCostCents(resolvedModel, inputTokens, outputTokens);

  // Extract text content
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ConversationError("No text content in API response");
  }

  // Parse JSON response — strip ```json fences if the model wrapped them.
  const stripped = stripJsonFence(textBlock.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new ConversationError(
      `Failed to parse conversation response as JSON: ${stripped.slice(0, 200)}`,
    );
  }

  // Validate with Zod
  let validated: ConverseResponse;
  try {
    validated = ConverseResponseSchema.parse(parsed);
  } catch (err) {
    throw new ConversationError(
      `Response validation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  return {
    response: validated,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    model: resolvedModel,
  };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
