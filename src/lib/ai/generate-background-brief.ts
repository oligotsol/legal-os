/**
 * Power-dialer background brief generator.
 *
 * Produces a 2-3 sentence at-a-glance summary of EVERYTHING we know about
 * a lead — intake dump (LegalMatch Q/A answers, etc.), matter type, client
 * description, and any prior conversation — so Garrison can see the full
 * background on the dialer card without opening the lead.
 *
 * Generated ONCE per lead (on create / via backfill) and stored on
 * `lead.payload.dialer.background_brief`. Re-generated when new inbound
 * messages arrive (handled by caller). Haiku, ~$0.0005/lead.
 *
 * Vertical-generic prompt — works for any practice area; firm + attorney
 * names come from firm_config.
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 220;

export interface BackgroundBriefInput {
  firstName?: string | null;
  fullName?: string | null;
  state?: string | null;
  matterType?: string | null;
  descriptionSummary?: string | null;
  clientDescription?: string | null;
  /** ALL recent messages (inbound + outbound), most recent first.
   *  LegalMatch / Zapier intake dumps are NOT filtered out — they're
   *  the prospect's actual answers and the brief should reflect them. */
  recentMessages?: Array<{
    direction: "inbound" | "outbound";
    content: string;
    channel?: string | null;
    createdAt?: string;
  }>;
}

export interface BackgroundBriefResult {
  brief: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  fellBack: boolean;
}

const SYSTEM_PROMPT = `You write a SHORT background brief that an attorney reads before calling a prospective client. Output PLAIN TEXT only, no markdown, no preamble.

Format: 2 to 3 sentences, max 60 words total. Focus on:
1. WHO the prospect is and WHAT they need (matter type, situation).
2. WHAT they've already told us — facts from their intake answers or messages. Prioritize concrete details (timeline, dollar amounts, family/property situation, urgency signals).
3. ANY open thread — did we last message them? Are they waiting on us? Did they ask a specific question?

Style:
- Conversational, like one attorney briefing another in the hallway.
- NEVER use em dashes or en dashes. Use commas, periods, or new sentences.
- No corporate jargon. No "the prospect has indicated."
- If intake gave structured answers (Q/A), distill them. Don't quote raw form fields.
- If we know almost nothing, say so plainly ("Limited info; intake says X. Call to qualify.").
- Don't repeat the prospect's name. Don't introduce yourself or the firm.

Output ONLY the brief text. No headers, no quotes around it.`;

function fallbackBrief(input: BackgroundBriefInput): string {
  const parts: string[] = [];
  if (input.matterType) {
    parts.push(`${input.matterType} inquiry${input.state ? ` (${input.state})` : ""}.`);
  }
  if (input.descriptionSummary) {
    parts.push(input.descriptionSummary);
  } else if (input.clientDescription) {
    const slice = input.clientDescription.slice(0, 140).trim();
    parts.push(slice.endsWith(".") ? slice : slice + ".");
  }
  if (input.recentMessages && input.recentMessages.length > 0) {
    const inboundCount = input.recentMessages.filter(
      (m) => m.direction === "inbound",
    ).length;
    const outboundCount = input.recentMessages.filter(
      (m) => m.direction === "outbound",
    ).length;
    if (outboundCount > 0) {
      parts.push(`We've messaged them ${outboundCount} time${outboundCount === 1 ? "" : "s"}.`);
    } else if (inboundCount > 0) {
      parts.push("They reached out; no reply yet.");
    }
  }
  return parts.join(" ") || "Limited intake info on file. Call to qualify.";
}

function sanitize(text: string): string {
  return text.replace(/[–—]/g, ", ").replace(/^\s+|\s+$/g, "");
}

export async function generateBackgroundBrief(
  input: BackgroundBriefInput,
): Promise<BackgroundBriefResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);

  const facts: string[] = [];
  if (input.firstName) facts.push(`Prospect first name: ${input.firstName}`);
  if (input.fullName) facts.push(`Prospect full name: ${input.fullName}`);
  if (input.state) facts.push(`State: ${input.state}`);
  if (input.matterType) facts.push(`Matter type: ${input.matterType}`);
  if (input.descriptionSummary)
    facts.push(`Matter summary: ${input.descriptionSummary}`);
  if (input.clientDescription) {
    // Long intakes are common — cap to keep input cheap. The first ~2000 chars
    // typically contain the description + the first chunk of Q/A pairs.
    facts.push(
      `Intake / client description:\n${input.clientDescription.slice(0, 2000)}`,
    );
  }
  if (input.recentMessages && input.recentMessages.length > 0) {
    const lines = input.recentMessages.slice(0, 6).map((m) => {
      const dir = m.direction === "inbound" ? "PROSPECT" : "WE SENT";
      const channel = m.channel ? ` (${m.channel})` : "";
      const body = m.content.slice(0, 800);
      return `[${dir}${channel}] ${body}`;
    });
    facts.push(`Recent messages (most recent first):\n${lines.join("\n---\n")}`);
  }

  const start = performance.now();
  const client = new Anthropic();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: resolvedModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the background brief from these facts:\n\n${facts.join("\n\n")}`,
        },
      ],
    });
  } catch (err) {
    console.error("[generateBackgroundBrief] Anthropic failed, using fallback:", err);
    return {
      brief: fallbackBrief(input),
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
  const raw = text && text.type === "text" ? text.text : "";
  const brief = sanitize(raw);
  if (!brief) {
    return {
      brief: fallbackBrief(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  return {
    brief,
    model: resolvedModel,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    fellBack: false,
  };
}
