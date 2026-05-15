/**
 * Power-dialer call-script generator.
 *
 * Produces a structured call script in the format the user prefers:
 *   - Opening: 1 line addressing prospect, attorney + firm + matter + state
 *   - Situation: 2-4 factual bullets about what the lead needs
 *   - Asks: 3-5 open discovery questions
 *   - Close: 1-2 lines moving the call to action (fee agreement / next step)
 *
 * Generated ONCE per lead (on create / via backfill) and stored on
 * `lead.payload.dialer.script`. The dialer reads it cached so the UI is
 * instant on lead switch. Haiku, ~$0.001/lead.
 *
 * Caller logs to ai_jobs per CLAUDE.md #5. Firm + attorney name come from
 * firm_config — vertical-generic prompt so Peregrine multi-tenant ports.
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 600;

export class CallScriptError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CallScriptError";
  }
}

export interface CallScript {
  opening: string;
  situation: string[];
  asks: string[];
  close: string;
}

export interface CallScriptInput {
  attorneyFirstName: string;
  firmDisplayName: string;
  /** Lead first name if known (we'll guess from full_name if needed). */
  firstName?: string | null;
  /** Last name if known — used as a hedge in the opening if the model has it. */
  fullName?: string | null;
  matterType?: string | null;
  /** Short summary (e.g. "TX Estate Planning Living Trust"). */
  descriptionSummary?: string | null;
  /** Longer client description from intake. */
  clientDescription?: string | null;
  state?: string | null;
  /** What the lead has said in their messages (most recent first), if any. */
  recentInbound?: string[];
}

export interface CallScriptResult {
  script: CallScript;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  fellBack: boolean;
}

const SYSTEM_PROMPT = `You write structured call scripts for an attorney calling a prospective client lead. Output STRICT JSON only — no preamble, no markdown fences, no commentary.

JSON shape:
{
  "opening": "string",
  "situation": ["string", "string", ...],
  "asks": ["string", "string", ...],
  "close": "string"
}

Rules:
- "opening": ONE sentence. Greet the prospect by first name, state the attorney name and firm, reference the matter naturally (e.g. "your estate planning matter", "your business transactional inquiry") and state if provided.
- "situation": 2 to 4 short factual bullets summarizing what we know about the matter. Statements, not questions. No fluff.
- "asks": 3 to 5 open discovery questions the attorney can read off the page. Practical and specific to the matter type when known; generic discovery when not.
- "close": ONE OR TWO sentences moving toward next step — sending a fee agreement, scheduling a follow-up, or quoting turnaround. Direct, no fluff.

Style:
- Plain, conversational English. No corporate jargon.
- NEVER use em dashes or en dashes. Use commas, periods, or new sentences.
- Don't restate the firm name in the situation bullets — it's in the opening.
- Don't quote the intake text verbatim in the situation — paraphrase.
- If matter info is missing, write a discovery-focused script (generic asks, no specific matter reference in the opening).

Output ONLY the JSON object.`;

function fallbackScript(input: CallScriptInput): CallScript {
  const greeting = input.firstName ? `Hi ${input.firstName}` : "Hi there";
  const matterPhrase = input.matterType
    ? ` about your ${input.matterType.toLowerCase()} matter`
    : "";
  const statePhrase = input.state ? ` in ${input.state}` : "";
  return {
    opening: `${greeting}, this is ${input.attorneyFirstName} with ${input.firmDisplayName}${matterPhrase}${statePhrase}.`,
    situation: [
      input.descriptionSummary ??
        input.matterType ??
        "Limited intake info on file.",
    ],
    asks: [
      "What's prompting the outreach today?",
      "Is this for you individually or you and your spouse?",
      "Do you own any real estate or businesses?",
      "Is there a timeline driving this?",
    ],
    close:
      "I can have everything drafted within 72 hours. I'll send over the fee agreement right now.",
  };
}

function stripJsonFence(s: string): string {
  let t = s.trim();
  if (t.startsWith("```")) {
    const firstNewline = t.indexOf("\n");
    if (firstNewline !== -1) t = t.slice(firstNewline + 1);
    if (t.endsWith("```")) t = t.slice(0, -3);
  }
  return t.trim();
}

function sanitizeStr(s: string): string {
  return s.replace(/[–—]/g, ",").replace(/^["'`]|["'`]$/g, "").trim();
}

function validateScript(j: unknown): CallScript | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const opening = typeof o.opening === "string" ? sanitizeStr(o.opening) : "";
  const close = typeof o.close === "string" ? sanitizeStr(o.close) : "";
  const situationRaw = Array.isArray(o.situation) ? o.situation : [];
  const asksRaw = Array.isArray(o.asks) ? o.asks : [];
  const situation = situationRaw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map(sanitizeStr);
  const asks = asksRaw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map(sanitizeStr);
  if (!opening || asks.length === 0) return null;
  return { opening, situation, asks, close: close || "Sound like something I can help with?" };
}

export async function generateCallScript(
  input: CallScriptInput,
): Promise<CallScriptResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);

  const facts: string[] = [
    `Attorney first name: ${input.attorneyFirstName}`,
    `Firm name: ${input.firmDisplayName}`,
  ];
  if (input.firstName) facts.push(`Prospect first name: ${input.firstName}`);
  if (input.fullName) facts.push(`Prospect full name: ${input.fullName}`);
  if (input.state) facts.push(`State: ${input.state}`);
  if (input.matterType) facts.push(`Matter type: ${input.matterType}`);
  if (input.descriptionSummary)
    facts.push(`Matter summary: ${input.descriptionSummary}`);
  if (input.clientDescription)
    facts.push(`Client description from intake:\n${input.clientDescription.slice(0, 1000)}`);
  if (input.recentInbound && input.recentInbound.length > 0) {
    const trimmed = input.recentInbound
      .filter((m) => !!m && m.trim().length > 0)
      .slice(0, 2)
      .map((m) => m.slice(0, 400));
    if (trimmed.length > 0) {
      facts.push(`What the prospect has said:\n${trimmed.map((m) => `- ${m}`).join("\n")}`);
    }
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
          content: `Generate the call script from these facts:\n\n${facts.join("\n")}`,
        },
      ],
    });
  } catch (err) {
    console.error("[generateCallScript] Anthropic failed, using fallback:", err);
    return {
      script: fallbackScript(input),
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
      script: fallbackScript(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text.text));
  } catch {
    return {
      script: fallbackScript(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  const validated = validateScript(parsed);
  if (!validated) {
    return {
      script: fallbackScript(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  return {
    script: validated,
    model: resolvedModel,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    fellBack: false,
  };
}

// ---------------------------------------------------------------------------
// Heuristic: is this inbound text the LegalMatch / Zapier intake dump?
// If so, we should NOT surface it as "What they said" — that's noise.
// ---------------------------------------------------------------------------

export function looksLikeIntakeDump(text: string): boolean {
  if (!text) return false;
  const t = text;
  return (
    t.includes("LEGALMATCH LEAD") ||
    t.includes("Parsed by Zapier") ||
    /^\s*New lead received/i.test(t) ||
    t.includes("CLIENT DESCRIPTION\n") ||
    t.includes("INTAKE ANSWERS")
  );
}
