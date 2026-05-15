/**
 * Phone normalization to E.164 for SMS opt-out and audit log keying.
 *
 * Rules:
 *   - Strip everything except digits.
 *   - If 10 digits, prepend "+1" (US default).
 *   - If 11 digits starting with "1", prepend "+".
 *   - If already starts with "+", keep digits + prefix.
 *   - Otherwise return null (caller should treat as unmatchable).
 *
 * Returned strings are always either null or a "+<digits>" string.
 */

export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    return "+" + digits;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length >= 11 && digits.length <= 15) return "+" + digits;
  return null;
}

/** Convenience: equals-check that's resilient to formatting differences. */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeE164(a);
  const nb = normalizeE164(b);
  if (!na || !nb) return false;
  return na === nb;
}
