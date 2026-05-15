/**
 * Merge-field validator for blast bodies.
 *
 * Identical text to N recipients is a spam pattern (and a TCPA red flag).
 * We require at least one merge field in any mass-blast body so each
 * recipient gets a distinct message at minimum on the name/state/firm axis.
 *
 * Recognized tokens: {first_name}, {state}, {firm_name}, {full_name}.
 */

const MERGE_TOKEN_RE = /\{(first_name|state|firm_name|full_name)\}/i;

export function bodyHasMergeField(body: string): boolean {
  if (!body) return false;
  return MERGE_TOKEN_RE.test(body);
}

export function assertBodyHasMergeField(body: string): void {
  if (!bodyHasMergeField(body)) {
    throw new Error(
      "Personalize the message before sending. Add {first_name}, {state}, {full_name}, or {firm_name} so each recipient gets a distinct text.",
    );
  }
}
