/**
 * Forwarded-lead parser — extracts the real lead's identity out of a
 * forwarded email body when the email's outer `From:` is a firm-internal
 * address (i.e., Garrison forwarding a vendor email to himself).
 *
 * Designed for the Zapier-processed LegalMatch template currently in use
 * at LFL. Body format (after stripping markdown asterisks):
 *
 *   Name: Thai Nguyen
 *   Phone: (832) 527-1598
 *   Email: bacsithai@yahoo.com
 *   Case #: CCL5DGG1UYJ
 *   Practice Area: Estate Planning
 *   State: TX
 *   City: Humble
 *   ...
 *
 * When other vendors / formats arrive, extend the regex set or add a
 * sibling parser keyed off `firm_config.gmail_forward_parser.format`.
 */

export interface ForwardParserConfig {
  enabled: boolean;
  /** Lowercased email addresses whose outbound mail should be treated as a forwarder. */
  forwarderAddresses: string[];
  /** Regex source for extracting the lead's name from the subject. Capture group 1 = name. */
  subjectPattern?: string;
}

export interface ParsedForwardedLead {
  name: string;
  email: string;
  phone: string | null;
  state: string | null;
  city: string | null;
  matterType: string | null;
  caseId: string | null;
  /** Multi-line free-text describing the client's matter. From the
   *  Zapier "CLIENT DESCRIPTION" section. Used as the table's Description
   *  column with hover-for-full-text tooltip. */
  clientDescription: string | null;
  /** Whole parsed key/value map for retention on lead.payload. */
  fields: Record<string, string>;
}

const DEFAULT_SUBJECT_PATTERN = /^(?:Fwd:\s*)?NEW LEAD:\s*(.+?)\s*$/i;

// Multi-line block: text after the "CLIENT DESCRIPTION" header, up to the
// next divider (`──...`) or the "INTAKE ANSWERS" header. Captures freeform
// matter description (e.g., "Plan to set up a living trust").
const CLIENT_DESCRIPTION_PATTERN =
  /CLIENT DESCRIPTION\s*\n([\s\S]+?)(?=\n\s*─{3,}|\n\s*INTAKE ANSWERS|$)/i;

// Intra-line whitespace only (`[ \t]*`); `\s*` would cross newlines under the
// `m` flag and pull values from the next line in the messy top section.
// `clientDescription` lives outside this map — it's a multi-line block, see
// CLIENT_DESCRIPTION_PATTERN below.
const FIELD_PATTERNS: Record<
  keyof Omit<ParsedForwardedLead, "fields" | "clientDescription">,
  RegExp
> = {
  name: /^Name:[ \t]*(.+?)[ \t]*$/im,
  email: /^Email:[ \t]*([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})[ \t]*$/im,
  phone: /^Phone:[ \t]*([+\d\s().\-]+?)[ \t]*$/im,
  state: /^State:[ \t]*([A-Z]{2})\b/im,
  city: /^City:[ \t]*(.+?)[ \t]*$/im,
  matterType: /^Practice Area:[ \t]*(.+?)[ \t]*$/im,
  caseId: /^Case[ \t]*#?:[ \t]*([A-Z0-9]+)[ \t]*$/im,
};

/** Strip markdown asterisks and normalize newlines so per-line regex works. */
function normalizeBody(body: string): string {
  return body.replace(/\*+/g, "").replace(/\r\n/g, "\n");
}

/**
 * Trim leading/trailing punctuation that leaks in from Zapier's markdown-ish
 * rendering (e.g., `Name:. Rosa Delacruz` after asterisk strip → leading `.`).
 */
function cleanValue(v: string): string {
  return v.replace(/^[\s.\-:*]+|[\s.\-:*]+$/g, "").trim();
}

/** Phone normalizer — strips formatting, prepends +1 for 10-digit US numbers. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8) return `+${digits}`;
  return null;
}

/**
 * Returns parsed lead identity, or null if:
 *   - parser is disabled
 *   - `fromEmail` is not a configured forwarder address
 *   - subject doesn't match the lead pattern
 *   - body has no usable email
 */
export function parseForwardedLead(args: {
  fromEmail: string;
  subject: string;
  body: string;
  config: ForwardParserConfig;
}): ParsedForwardedLead | null {
  const { fromEmail, subject, body, config } = args;

  if (!config.enabled) return null;

  const fromLower = fromEmail.toLowerCase();
  if (!config.forwarderAddresses.map((a) => a.toLowerCase()).includes(fromLower)) {
    return null;
  }

  const subjectRegex = config.subjectPattern
    ? new RegExp(config.subjectPattern, "i")
    : DEFAULT_SUBJECT_PATTERN;
  const subjectMatch = subject.match(subjectRegex);
  if (!subjectMatch) return null;

  const subjectName = (subjectMatch[1] ?? "").trim();

  const normalized = normalizeBody(body);
  const fields: Record<string, string> = {};

  let bodyName: string | undefined;
  let email: string | undefined;
  let phone: string | null = null;
  let state: string | null = null;
  let city: string | null = null;
  let matterType: string | null = null;
  let caseId: string | null = null;
  let clientDescription: string | null = null;

  const descMatch = normalized.match(CLIENT_DESCRIPTION_PATTERN);
  if (descMatch) {
    const desc = descMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" ")
      .trim();
    if (desc) {
      clientDescription = desc;
      fields.clientDescription = desc;
    }
  }

  for (const [key, pattern] of Object.entries(FIELD_PATTERNS) as [
    keyof typeof FIELD_PATTERNS,
    RegExp,
  ][]) {
    const m = normalized.match(pattern);
    if (!m) continue;
    const value = cleanValue(m[1]);
    if (!value) continue;
    fields[key] = value;
    if (key === "name") bodyName = value;
    else if (key === "email") email = value.toLowerCase();
    else if (key === "phone") phone = normalizePhone(value);
    else if (key === "state") state = value.toUpperCase();
    else if (key === "city") city = value;
    else if (key === "matterType") matterType = value;
    else if (key === "caseId") caseId = value;
  }

  if (!email) return null;

  // Subject is the more reliable name source — Zapier's body has a noisy
  // top section ("Name:. Rosa Delacruz") plus a clean structured section
  // ("LEGALMATCH LEAD - Rosa Delacruz"). Prefer subject, fall back to body.
  return {
    name: subjectName || bodyName || email,
    email,
    phone,
    state,
    city,
    matterType,
    caseId,
    clientDescription,
    fields,
  };
}
