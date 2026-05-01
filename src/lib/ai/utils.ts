/**
 * Shared AI utilities — token cost computation, model constants.
 *
 * Pricing is per 1M tokens (input/output) as of 2025-Q2.
 * Update when Anthropic changes pricing.
 */

interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { inputPer1M: 0.80, outputPer1M: 4.00 },
  // Sonnet 4.6
  "claude-sonnet-4-6-20250514": { inputPer1M: 3.00, outputPer1M: 15.00 },
  // Opus 4.6
  "claude-opus-4-6-20250610": { inputPer1M: 15.00, outputPer1M: 75.00 },
};

/** Short aliases → canonical model IDs */
const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6-20250514",
  opus: "claude-opus-4-6-20250610",
};

/**
 * Resolve a model alias (e.g. "haiku") to its canonical model ID.
 * Returns the input unchanged if it's already a full model ID.
 */
export function resolveModelId(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

/**
 * Compute the cost in cents for a given model + token usage.
 * Returns 0 if the model is unknown (logs a warning).
 */
export function computeTokenCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const canonical = resolveModelId(model);
  const pricing = MODEL_PRICING[canonical];

  if (!pricing) {
    console.warn(`[ai/utils] Unknown model for pricing: ${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;

  // Convert USD to cents, round to 4 decimal places
  return Math.round((inputCost + outputCost) * 100 * 10000) / 10000;
}
