/**
 * Lead classification — first Anthropic SDK caller in the codebase.
 *
 * Calls the API, parses the response, returns a typed result.
 * Does NOT write to DB — caller is responsible for inserting
 * into `classifications` and `ai_jobs`.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  buildClassificationPrompt,
  type ClassificationConfig,
  type ClassificationInput,
} from "./prompts/classify";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";

export interface ClassifyResult {
  matterType: string;
  confidence: number;
  signals: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  model: string;
}

export class ClassificationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ClassificationError";
  }
}

/**
 * Classify a lead using the Anthropic API.
 *
 * @param config - Firm-level classification config (matter types, threshold)
 * @param input - Lead data to classify
 * @param model - Model alias or full ID (defaults to "haiku")
 * @returns ClassifyResult with all fields needed for classifications + ai_jobs inserts
 */
export async function classifyLead(
  config: ClassificationConfig,
  input: ClassificationInput,
  model: string = DEFAULT_MODEL,
): Promise<ClassifyResult> {
  const resolvedModel = resolveModelId(model);
  const prompt = buildClassificationPrompt(config, input);

  const client = new Anthropic();
  const start = performance.now();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolvedModel,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw new ClassificationError(
      `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const latencyMs = Math.round(performance.now() - start);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costCents = computeTokenCostCents(resolvedModel, inputTokens, outputTokens);

  // Extract text content from response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ClassificationError("No text content in API response");
  }

  // Parse JSON response
  let parsed: { matter_type?: string; confidence?: number; signals?: Record<string, unknown> };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new ClassificationError(
      `Failed to parse classification response as JSON: ${textBlock.text.slice(0, 200)}`,
    );
  }

  if (!parsed.matter_type || typeof parsed.confidence !== "number") {
    throw new ClassificationError(
      `Invalid classification response: missing matter_type or confidence`,
    );
  }

  return {
    matterType: parsed.matter_type,
    confidence: parsed.confidence,
    signals: parsed.signals ?? {},
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    model: resolvedModel,
  };
}
