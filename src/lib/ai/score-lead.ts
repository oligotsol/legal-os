/**
 * Lead-quality scorer.
 *
 * Produces a TIER (hot/warm/cool/cold/unknown) + an in-tier sub-score (0-100)
 * + concrete reasoning + urgency signals quoted from the intake. Designed to
 * be useful, not decorative: the model is explicitly instructed to return
 * `unknown` when there's not enough information rather than guess.
 *
 * Inputs are all the qualifying signal we have on a lead at intake time:
 * matter type, the intake body, state, source, list_name, plus any inbound
 * messages already on the conversation.
 *
 * Stored on `lead.payload.lead_score`. Generated ONCE per lead at intake
 * (alongside the call script + background brief). No backfill — only new
 * leads going forward get a score. Older leads sort by "unknown" tier
 * weighting (neutral) until and unless re-scored.
 *
 * Haiku, ~$0.001/lead. Logs to ai_jobs per CLAUDE.md #5.
 *
 * Vertical-generic by design — the prompt references "legal matter" not
 * "estate planning". Firm-specific signal (active practice areas, key
 * matter types) is injected from firm_config when available.
 */

import Anthropic from "@anthropic-ai/sdk";
import { computeTokenCostCents, resolveModelId } from "./utils";

const DEFAULT_MODEL = "haiku";
const MAX_OUTPUT_TOKENS = 320;

export type LeadScoreTier = "hot" | "warm" | "cool" | "cold" | "unknown";

export interface LeadScore {
  tier: LeadScoreTier;
  /** 0-100 sub-score within the tier. Lets us sort precisely between two
   *  "warm" leads. For tier=unknown, score is always 0. */
  score: number;
  /** One concise sentence explaining the tier classification. Always
   *  references actual lead info, never invents facts. */
  reasoning: string;
  /** Concrete phrases lifted (or close-to-verbatim) from the intake that
   *  evidence urgency. Empty if none present. */
  urgency_signals: string[];
  /** What we'd need to know to score this better. Useful for unknown/cold
   *  tiers so the team understands the gap. */
  missing_info: string[];
}

export interface LeadScoreInput {
  fullName?: string | null;
  matterType?: string | null;
  descriptionSummary?: string | null;
  /** Longer intake body — capped at 1500 chars inside this function. */
  clientDescription?: string | null;
  state?: string | null;
  source: string;
  listName?: string | null;
  /** Recent inbound messages (most recent first). Capped to 3 × 400 chars. */
  recentInbound?: string[];
  /** True if the lead has a phone we can dial. */
  hasPhone: boolean;
  /** True if the lead has an email we can reach. */
  hasEmail: boolean;
}

export interface LeadScoreResult {
  score: LeadScore;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  fellBack: boolean;
}

const SYSTEM_PROMPT = `You classify a prospective legal-client lead on likelihood to retain (sign + pay) in the near term. Output STRICT JSON only — no preamble, no markdown fences.

Output shape:
{
  "tier": "hot" | "warm" | "cool" | "cold" | "unknown",
  "score": 0-100,
  "reasoning": "<one short sentence>",
  "urgency_signals": ["<concrete phrase>", ...],
  "missing_info": ["<what we need to know>", ...]
}

TIER DEFINITIONS:
- "hot"  — Clear urgency signals (recent death/diagnosis/move/sale, deadline, "ASAP", actively shopping) PLUS qualifying detail (matter type, complexity, contact responsiveness). Likely to close within days. Top priority.
- "warm" — Clear intent + qualifying signals + reasonably specific intake. Knows what they need, gives concrete details. Likely to close within weeks.
- "cool" — Interest signal present, but limited info, hesitation, or only generic questions. Real lead, but earlier in their decision cycle.
- "cold" — Minimal info, browsing intent, vague, or out-of-scope signals. Don't penalize entirely (could re-engage), but de-prioritize.
- "unknown" — Insufficient information to classify confidently. Phone-only imports with zero intake content go here. Use this honestly — DO NOT guess when the data is thin.

CALIBRATION RULES (read carefully):
1. NEVER fabricate urgency. urgency_signals MUST be phrases the prospect actually wrote (or a close paraphrase). If you can't quote evidence, leave the array empty.
2. NEVER score "hot" without a concrete urgency signal you can point to.
3. NEVER score "warm" without at least matter_type identified + 1-2 lines of intake.
4. If intake is just "name + phone, no other detail", tier MUST be "unknown" (not "cold" — they might be great, we just don't know).
5. reasoning is one sentence, present-tense, references actual lead info.
6. score is 0-100 within the tier. Two hot leads can be 80 and 95.
7. missing_info: what would change your classification if known? (Skip for hot/warm if it's a strong lead.)

Output ONLY the JSON object, nothing else.`;

function fallbackScore(input: LeadScoreInput): LeadScore {
  const hasIntake =
    !!(input.descriptionSummary?.trim() || input.clientDescription?.trim());
  if (!hasIntake && !input.matterType) {
    return {
      tier: "unknown",
      score: 0,
      reasoning: "No intake content on file — phone-only lead, needs qualification call.",
      urgency_signals: [],
      missing_info: ["matter type", "client situation", "urgency"],
    };
  }
  return {
    tier: "cool",
    score: 50,
    reasoning: input.matterType
      ? `${input.matterType} inquiry with minimal qualifying detail.`
      : "Generic inquiry with limited detail.",
    urgency_signals: [],
    missing_info: ["urgency timeline", "complexity indicators"],
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

function validateScore(j: unknown): LeadScore | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const tierRaw =
    typeof o.tier === "string" ? o.tier.toLowerCase() : "";
  const tier: LeadScoreTier = (
    ["hot", "warm", "cool", "cold", "unknown"] as const
  ).includes(tierRaw as LeadScoreTier)
    ? (tierRaw as LeadScoreTier)
    : "unknown";
  const rawScore =
    typeof o.score === "number" ? Math.max(0, Math.min(100, Math.round(o.score))) : 50;
  const score = tier === "unknown" ? 0 : rawScore;
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim().length > 0
      ? o.reasoning.trim().replace(/[–—]/g, ",").slice(0, 400)
      : "Reasoning unavailable.";
  const urgency_signals = Array.isArray(o.urgency_signals)
    ? (o.urgency_signals as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.replace(/[–—]/g, ",").trim().slice(0, 200))
        .slice(0, 5)
    : [];
  const missing_info = Array.isArray(o.missing_info)
    ? (o.missing_info as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 120))
        .slice(0, 5)
    : [];
  return { tier, score, reasoning, urgency_signals, missing_info };
}

export async function scoreLead(input: LeadScoreInput): Promise<LeadScoreResult> {
  const resolvedModel = resolveModelId(DEFAULT_MODEL);

  const facts: string[] = [];
  facts.push(`Source: ${input.source}`);
  if (input.listName) facts.push(`Import list: ${input.listName}`);
  if (input.fullName) facts.push(`Full name: ${input.fullName}`);
  if (input.state) facts.push(`State: ${input.state}`);
  if (input.matterType) facts.push(`Matter type: ${input.matterType}`);
  if (input.descriptionSummary)
    facts.push(`Matter summary: ${input.descriptionSummary}`);
  if (input.clientDescription) {
    facts.push(
      `Intake body:\n${input.clientDescription.slice(0, 1500)}`,
    );
  }
  facts.push(
    `Contact channels available: ${[
      input.hasPhone ? "phone" : null,
      input.hasEmail ? "email" : null,
    ]
      .filter(Boolean)
      .join(", ") || "none"}`,
  );
  if (input.recentInbound && input.recentInbound.length > 0) {
    const lines = input.recentInbound
      .slice(0, 3)
      .map((m, i) => `(${i + 1}) ${m.slice(0, 400)}`);
    facts.push(`Recent inbound messages:\n${lines.join("\n---\n")}`);
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
          content: `Classify this lead. Facts:\n\n${facts.join("\n")}`,
        },
      ],
    });
  } catch (err) {
    console.error("[scoreLead] Anthropic failed, using fallback:", err);
    return {
      score: fallbackScore(input),
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
      score: fallbackScore(input),
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
      score: fallbackScore(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }
  const validated = validateScore(parsed);
  if (!validated) {
    return {
      score: fallbackScore(input),
      model: resolvedModel,
      inputTokens,
      outputTokens,
      costCents,
      latencyMs,
      fellBack: true,
    };
  }

  return {
    score: validated,
    model: resolvedModel,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    fellBack: false,
  };
}

/**
 * Sort weight: encodes tier priority + sub-score into a single number for
 * queue sorting. Higher = call first.
 *   hot  → 4000-4100
 *   warm → 3000-3100
 *   cool → 2000-2100
 *   cold → 1000-1100
 *   unknown → 1500 (neutral — between cool and warm, so unscored leads
 *                   aren't punished or rewarded)
 */
export function leadScoreSortWeight(score: LeadScore | null): number {
  if (!score) return 1500;
  const base: Record<LeadScoreTier, number> = {
    hot: 4000,
    warm: 3000,
    unknown: 1500,
    cool: 2000,
    cold: 1000,
  };
  return base[score.tier] + (score.tier === "unknown" ? 0 : score.score);
}
