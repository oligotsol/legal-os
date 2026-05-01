/**
 * Template engine — renders {{variable}} placeholders.
 *
 * Pure string transforms. No DB calls.
 * Missing variables are replaced with empty string (warns, does not throw).
 */

export interface TemplateContext {
  contact_name: string;
  first_name: string;
  attorney_name: string;
  attorney_email: string;
  firm_name: string;
  phone_number: string;
  scheduling_link: string;
  matter_type?: string;
  state?: string;
  payment_language?: string;
  [key: string]: string | undefined;
}

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Render a template by replacing {{variable}} placeholders with values
 * from the context. Missing variables are replaced with empty string.
 */
export function renderTemplate(
  bodyTemplate: string,
  context: TemplateContext,
): string {
  if (!bodyTemplate) return "";

  return bodyTemplate.replace(VARIABLE_PATTERN, (match, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) {
      console.warn(`[template-engine] Missing variable: {{${key}}}`);
      return "";
    }
    return String(value);
  });
}

/**
 * Render a template for SMS, truncating at sentence boundaries if needed.
 * Falls back to word boundary, then hard truncation with "..." suffix.
 */
export function renderSmsTemplate(
  bodyTemplate: string,
  context: TemplateContext,
  maxLength: number = 300,
): string {
  const rendered = renderTemplate(bodyTemplate, context);
  if (rendered.length <= maxLength) return rendered;

  // Truncate at sentence boundary
  const truncated = rendered.slice(0, maxLength);
  // Find last sentence-ending punctuation
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("! "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf(".\n"),
    truncated.lastIndexOf("!\n"),
    truncated.lastIndexOf("?\n"),
  );

  if (lastSentenceEnd > 0) {
    return rendered.slice(0, lastSentenceEnd + 1);
  }

  // Fallback: truncate at last word boundary, add ...
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.5 && lastSpace + 3 <= maxLength) {
    return rendered.slice(0, lastSpace) + "...";
  }

  return rendered.slice(0, maxLength - 3) + "...";
}
