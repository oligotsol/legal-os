/**
 * Power-dialer SMS generator — produces a short, friendly outreach text the
 * dialer auto-sends after a no-answer first call.
 *
 * Designed for the power-dialer flow only: Garrison rings the lead, no
 * answer, this fires while the dialer rings them back. Tone: warm,
 * conversational, ends with a question that invites a callback.
 *
 * Pattern lifted from src/lib/ai/summarize-lead.ts. Haiku (~$0.0005/call).
 * Caller is responsible for logging the call to ai_jobs (CLAUDE.md #5).
 *
 * System prompt is vertical-generic ("an attorney") — firm + attorney name
 * are injected as facts so other tenants port cleanly (CLAUDE.md #6/#7).
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 80;
/** Target length the prompt asks the model to hit. NOT enforced as a hard
 *  truncate — going over just means Dialpad sends it as multi-part SMS
 *  (transparent to the recipient). We never want to send a half-sentence. */
const TARGET_CHARS = 140;

export class DialerSmsError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DialerSmsError";
  }
}

export interface DialerSmsInput {
  /** Firm-config-provided. e.g. "Garrison" */
  attorneyFirstName: string;
  /** Firm-config-provided. e.g. "Legacy First Law" */
  firmDisplayName: string;
  /** Lead's first name if we have one; we'll guess from full_name. */
  firstName?: string | null;
  /** Short matter summary, e.g. "Estate Planning Living Trust". */
  matterSummary?: string | null;
  /** Longer client description if available — used for context, not quoted verbatim. */
  clientDescription?: string | null;
  /** Optional state / city for natural reference. */
  state?: string | null;
}

export interface DialerSmsResult {
  body: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  /** True if we returned the deterministic fallback instead of an AI body. */
  fellBack: boolean;
}

const SYSTEM_PROMPT = `You write a SHORT friendly text-message (target ~140 characters, 1 sentence, no emojis, no signature, no quotes around the output) from an attorney following up on a missed call to a prospective client.

Rules:
- Address the prospect by first name if provided.
- Reference their matter naturally; don't quote the verbose intake. A short noun phrase is enough.
- End with a complete question that invites a callback. The last character must be "?" — never a comma, ellipsis, or trailing period.
- NEVER end with "..." or "…" or any kind of mid-sentence cutoff. The message must be a complete thought.
- Never use em dashes or en dashes; use commas or new sentences.
- Do not include the attorney's full sign-off or firm-name footer; firm/attorney mention should be brief and natural.
- If the message would run long, rewrite it shorter; do not truncate.

Examples:
- "Hey Mary, this is Garrison from Legacy First Law trying to reach you about your trust setup. When's a good time to chat?"
- "Hi Jordan, missed you just now about your estate plan. Got a minute later today?"

Output ONLY the message body, nothing else.`;

function deterministicFallback(input: DialerSmsInput): string {
  // Short by construction — well under 160 chars regardless of input —
  // so we never need to truncate the fallback.
  const greeting = input.firstName ? `Hey ${input.firstName}` : "Hey there";
  return `${greeting}, this is ${input.attorneyFirstName} from ${input.firmDisplayName}. When's a good time to chat?`;
}

export async function generateDialerSms(
  input: DialerSmsInput,
): Promise<DialerSmsResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);

  const facts: string[] = [
    `Attorney first name: ${input.attorneyFirstName}`,
    `Firm name: ${input.firmDisplayName}`,
  ];
  if (input.firstName) facts.push(`Prospect first name: ${input.firstName}`);
  if (input.matterSummary) facts.push(`Matter: ${input.matterSummary}`);
  if (input.clientDescription) {
    facts.push(
      `Intake notes (for your context only, do not quote verbatim):\n${input.clientDescription.slice(0, 600)}`,
    );
  }
  if (input.state) facts.push(`State: ${input.state}`);

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
          content: `Write the SMS using these facts:\n\n${facts.join("\n")}`,
        },
      ],
    });
  } catch (err) {
    // Don't fail the cadence on AI hiccup — return a deterministic fallback.
    console.error("[generateDialerSms] Anthropic failed, using fallback:", err);
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

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new DialerSmsError("No text content in API response");
  }

  let body = textBlock.text.trim();
  // Strip stray quotes the model sometimes emits.
  body = body.replace(/^["'`]|["'`]$/g, "");
  // Em/en dashes never belong in our voice; replace with commas.
  body = body.replace(/[–—]/g, ",");
  // Strip any trailing ellipsis the model snuck in — we will NEVER send a
  // half-sentence text. If the model truly produced a mid-thought, fall back
  // to the deterministic short body rather than ship the cutoff.
  if (/(\.\.\.|…)\s*$/.test(body)) {
    console.warn("[generateDialerSms] model emitted trailing ellipsis, falling back");
    body = deterministicFallback(input);
  }
  if (body.length === 0) body = deterministicFallback(input);
  // No char-cap truncation — Dialpad sends multi-part SMS for longer bodies.
  // TARGET_CHARS is a soft guideline the prompt enforces, not a hard slice.
  void TARGET_CHARS;

  return {
    body,
    model: resolvedModel,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    fellBack: false,
  };
}
