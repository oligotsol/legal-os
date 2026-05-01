/**
 * Pure prompt builder for lead classification.
 *
 * Takes firm-level config (matter types, confidence threshold) and
 * lead data, returns a system prompt. No DB calls, no side effects.
 */

export interface ClassificationConfig {
  matterTypes: string[];        // from firm_config.classification_config
  confidenceThreshold: number;  // minimum confidence to auto-classify
}

export interface ClassificationInput {
  leadSource: string;
  leadPayload: Record<string, unknown>;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

/**
 * Build the system prompt for lead classification.
 *
 * Instructs the model to classify the lead into one of the configured
 * matter types with a confidence score and supporting signals.
 *
 * Output format: JSON with `matter_type`, `confidence`, `signals`.
 */
export function buildClassificationPrompt(
  config: ClassificationConfig,
  input: ClassificationInput,
): string {
  const matterList = config.matterTypes
    .map((t) => `- ${t}`)
    .join("\n");

  const contactInfo = [
    input.contactName && `Name: ${input.contactName}`,
    input.contactEmail && `Email: ${input.contactEmail}`,
    input.contactPhone && `Phone: ${input.contactPhone}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a legal intake classifier. Your job is to analyze incoming lead data and classify it into the most appropriate matter type.

## Available Matter Types
${matterList}

## Classification Rules
1. Analyze the lead source, payload data, and any contact information.
2. Select the single best-matching matter type from the list above.
3. Assign a confidence score from 0.0 to 1.0.
4. Extract key signals that informed your classification.
5. If no matter type is a good fit, use "unknown" as the matter_type with low confidence.

## Confidence Guidelines
- 0.9-1.0: Clear, unambiguous match (e.g., lead explicitly mentions the service)
- 0.7-0.89: Strong match with some inference required
- 0.5-0.69: Moderate match, may need human review
- Below 0.5: Weak match, likely needs human classification

The auto-classification threshold is ${config.confidenceThreshold}. Classifications below this threshold should be flagged for human review.

## Lead Data
Source: ${input.leadSource}
${contactInfo ? `\n## Contact Information\n${contactInfo}` : ""}

## Lead Payload
${JSON.stringify(input.leadPayload, null, 2)}

## Response Format
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "matter_type": "<one of the matter types above, or 'unknown'>",
  "confidence": <number between 0 and 1>,
  "signals": {
    "primary_indicator": "<what most strongly suggests this classification>",
    "supporting_factors": ["<additional signals>"],
    "concerns": ["<anything that reduces confidence>"]
  }
}`;
}
