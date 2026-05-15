/**
 * sms_sends append-only audit log. Authoritative per-send record for TCPA
 * defense — one row per attempted send (including failures, skips, dry runs).
 *
 * Status enum (matches DB CHECK constraint):
 *   sent              — message accepted by Dialpad
 *   failed            — dispatch threw or Dialpad rejected
 *   skipped_opt_out   — phone is in sms_opt_outs for this firm
 *   skipped_consent   — (reserved for future H — sms_consent column)
 *   skipped_dnc       — contact.dnc=true at send time
 *   skipped_window    — outside send window when worker tried to dispatch
 *   dry_run           — preview-only; nothing actually sent
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SmsSendStatus =
  | "sent"
  | "failed"
  | "skipped_opt_out"
  | "skipped_consent"
  | "skipped_dnc"
  | "skipped_window"
  | "dry_run";

export interface LogSmsSendArgs {
  admin: SupabaseClient;
  firmId: string;
  blastId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  messageId?: string | null;
  phoneE164: string;
  body: string;
  status: SmsSendStatus;
  dialpadMessageId?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
}

/**
 * Best-effort write. Never throws — TCPA logging failure should not break
 * the user-visible send flow (the messages table is still the source of
 * truth for whether content was sent).
 */
export async function logSmsSend(args: LogSmsSendArgs): Promise<void> {
  try {
    const { error } = await args.admin.from("sms_sends").insert({
      firm_id: args.firmId,
      blast_id: args.blastId ?? null,
      contact_id: args.contactId ?? null,
      lead_id: args.leadId ?? null,
      message_id: args.messageId ?? null,
      phone_e164: args.phoneE164,
      body: args.body,
      status: args.status,
      dialpad_message_id: args.dialpadMessageId ?? null,
      error_message: args.errorMessage ?? null,
      sent_at: args.sentAt ?? null,
    });
    if (error) {
      console.error("[sms_sends] log insert failed:", error.message);
    }
  } catch (err) {
    console.error("[sms_sends] log insert threw:", err);
  }
}
