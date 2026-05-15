/**
 * Lead description summarizer — produces a concise services-list summary
 * for the leads table (e.g. "Revocable Living Trust Medical Power of Attorney",
 * "TX Business Law Contract Draft", "LLC Formation").
 *
 * Uses Haiku for cost (~$0.0005/lead). Caller persists the result on
 * `lead.payload.description_summary` (kept separate from the longer
 * `client_description` so the table column has a tight string and the hover
 * tooltip can still surface the full body).
 *
 * Every call must be logged to `ai_jobs` by the caller (CLAUDE.md rule #5).
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 60;
const MAX_CHARS = 120;

export class SummarizeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SummarizeError";
  }
}

export interface SummarizeInput {
  /** Anything we know about the matter from the parser / CSV import. */
  matterType?: string | null;
  clientDescription?: string | null;
  state?: string | null;
  /** Recent inbound message bodies (most recent first or chronological — order
   *  doesn't matter, we just pass them as context). */
  recentMessages?: string[];
  /** Hint from intake about the channel/origin. */
  source?: string | null;
  channel?: string | null;
}

export interface SummarizeResult {
  description: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  model: string;
}

const SYSTEM_PROMPT = `You write a CONCISE one-line description of a legal lead, in the style of a services list. Two to eight words. Title case nouns, no verbs, no punctuation except hyphens.

Examples of good output:
- Revocable Living Trust Medical Power of Attorney
- TX Business Law Contract Draft
- LLC Formation
- 2 Revocable Living Trusts 2 Warranty Deeds
- Estate Planning Intake
- Defective Mini Split Installation Dispute

Examples of bad output (do NOT do this):
- "The client wants to set up a will." (full sentence)
- "Lead from Gmail" (channel, not matter)
- "Estate planning matter for client based in Texas" (verbose, prose)

If you don't have enough information to identify the matter, output "Pending Intake".
Never use em dashes. Never wrap output in quotes. Output ONLY the description string.`;

export async function summarizeLeadDescription(
  input: SummarizeInput,
): Promise<SummarizeResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);

  const facts: string[] = [];
  if (input.matterType) facts.push(`Matter type: ${input.matterType}`);
  if (input.state) facts.push(`State: ${input.state}`);
  if (input.source) facts.push(`Source: ${input.source}`);
  if (input.channel) facts.push(`Channel: ${input.channel}`);
  if (input.clientDescription) {
    facts.push(`Description from intake:\n${input.clientDescription.slice(0, 1000)}`);
  }
  if (input.recentMessages && input.recentMessages.length > 0) {
    const trimmed = input.recentMessages
      .map((m) => (m ?? "").trim())
      .filter((m) => m.length > 0)
      .slice(0, 3)
      .map((m) => m.slice(0, 400));
    if (trimmed.length > 0) {
      facts.push(`Recent inbound messages:\n${trimmed.map((m) => `- ${m}`).join("\n")}`);
    }
  }

  if (facts.length === 0) {
    return {
      description: "Pending Intake",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      latencyMs: 0,
      model: resolvedModel,
    };
  }

  const client = new Anthropic();
  const start = performance.now();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolvedModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate a concise services-list description from these facts:\n\n${facts.join("\n\n")}`,
        },
      ],
    });
  } catch (err) {
    throw new SummarizeError(
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
    throw new SummarizeError("No text content in API response");
  }

  let description = textBlock.text.trim();
  // Strip stray quotes / em-dashes the model sometimes emits.
  description = description.replace(/^["'`]|["'`]$/g, "");
  description = description.replace(/[–—]/g, ",");
  if (description.length > MAX_CHARS) {
    description = description.slice(0, MAX_CHARS).trimEnd() + "…";
  }
  if (description.length === 0) description = "Pending Intake";

  return {
    description,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    model: resolvedModel,
  };
}
