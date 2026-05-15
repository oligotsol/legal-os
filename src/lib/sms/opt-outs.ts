/**
 * sms_opt_outs read/write helpers. Phone-number-level opt-out registry —
 * survives contact deletion and re-import. Authoritative answer to
 * "may we text this number?".
 *
 * Writes are idempotent (one row per firm+phone). Reads are batched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeE164 } from "./phone";

const STOP_KEYWORDS = [
  "stop",
  "unsubscribe",
  "quit",
  "cancel",
  "remove",
  "remove me",
  "opt out",
  "do not contact",
  "do not text",
  "do not call",
  "take me off",
] as const;

/**
 * Detect STOP-style opt-out language. Word-boundary match against an inbound
 * SMS body. Returns the first matched keyword if any, else null.
 */
export function detectOptOutKeyword(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of STOP_KEYWORDS) {
    // For single-word commands, use word boundary; for phrases, plain match.
    if (!kw.includes(" ")) {
      const re = new RegExp(`\\b${kw}\\b`, "i");
      if (re.test(lower)) return kw;
    } else {
      if (lower.includes(kw)) return kw;
    }
  }
  return null;
}

export interface RecordOptOutArgs {
  admin: SupabaseClient;
  firmId: string;
  phone: string | null | undefined;
  triggerKeyword: string;
  sourceMessageId?: string | null;
  contactId?: string | null;
}

/** Idempotent: ON CONFLICT (firm_id, phone_e164) DO NOTHING. */
export async function recordOptOut(args: RecordOptOutArgs): Promise<{
  inserted: boolean;
  phoneE164: string | null;
}> {
  const phoneE164 = normalizeE164(args.phone);
  if (!phoneE164) return { inserted: false, phoneE164: null };

  // Supabase JS doesn't expose ON CONFLICT DO NOTHING directly, but the
  // UNIQUE (firm_id, phone_e164) constraint will throw on duplicate. We
  // catch the unique-violation and treat it as success (already opted out).
  const { error } = await args.admin.from("sms_opt_outs").insert({
    firm_id: args.firmId,
    phone_e164: phoneE164,
    trigger_keyword: args.triggerKeyword,
    source_message_id: args.sourceMessageId ?? null,
    contact_id: args.contactId ?? null,
  });
  if (error) {
    // 23505 = unique_violation in Postgres.
    if (error.code === "23505") {
      return { inserted: false, phoneE164 };
    }
    console.error("[sms_opt_outs] insert failed:", error.message);
    return { inserted: false, phoneE164 };
  }
  return { inserted: true, phoneE164 };
}

/**
 * Batch lookup. Given a list of phone-ish strings, return the set of those
 * that have an active opt-out for this firm. Caller normalizes (or this
 * function normalizes internally).
 */
export async function fetchOptedOutPhones(
  admin: SupabaseClient,
  firmId: string,
  phones: Array<string | null | undefined>,
): Promise<Set<string>> {
  const normalized = phones
    .map((p) => normalizeE164(p))
    .filter((p): p is string => p !== null);
  if (normalized.length === 0) return new Set();

  const { data, error } = await admin
    .from("sms_opt_outs")
    .select("phone_e164")
    .eq("firm_id", firmId)
    .in("phone_e164", normalized);
  if (error) {
    console.error("[sms_opt_outs] fetch failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.phone_e164 as string));
}
