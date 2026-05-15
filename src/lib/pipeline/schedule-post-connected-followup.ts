/**
 * Schedule a 3-touch follow-up sequence for a lead Garrison marked
 * "Connected" but didn't immediately convert into a matter.
 *
 * Cadence:
 *   - +24h: short SMS warm follow-up ("good talking yesterday — when works to keep moving?")
 *   - +72h: email circle-back with a concrete next step
 *   - +7d:  last-touch email, low-pressure ("if now isn't right, just say the word")
 *
 * Each step inserts a scheduled_actions row with metadata.type =
 * 'post_connected_followup'. The post-connected-followup-worker picks them
 * up on schedule, generates the actual draft via Haiku (with firm voice
 * doctrine), and queues it as pending_approval so Garrison reviews
 * before send.
 *
 * Cancels: if the lead replies, the existing cancel-on-reply path already
 * cancels ALL pending scheduled_actions for the contact, including these.
 * If the lead is converted/removed, we cancel explicitly via
 * cancelPostConnectedFollowups.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScheduleFollowupArgs {
  admin: SupabaseClient;
  firmId: string;
  leadId: string;
  contactId: string;
  conversationId: string | null;
  callContextNote?: string | null; // optional brief note from Garrison
}

const STEPS: Array<{
  step: 1 | 2 | 3;
  hoursOffset: number;
  channel: "sms" | "email";
}> = [
  { step: 1, hoursOffset: 24, channel: "sms" },
  { step: 2, hoursOffset: 72, channel: "email" },
  { step: 3, hoursOffset: 24 * 7, channel: "email" },
];

export async function schedulePostConnectedFollowup(
  args: ScheduleFollowupArgs,
): Promise<{ scheduled: number; actionIds: string[] }> {
  const { admin, firmId, leadId, contactId, conversationId, callContextNote } =
    args;

  const now = Date.now();
  const rows = STEPS.map((s) => ({
    firm_id: firmId,
    campaign_id: null,
    template_id: null,
    matter_id: null,
    lead_id: leadId,
    contact_id: contactId,
    scheduled_for: new Date(now + s.hoursOffset * 3600 * 1000).toISOString(),
    status: "pending" as const,
    metadata: {
      type: "post_connected_followup",
      step: s.step,
      channel: s.channel,
      conversation_id: conversationId,
      call_context_note: callContextNote ?? null,
    },
  }));

  const { data, error } = await admin
    .from("scheduled_actions")
    .insert(rows)
    .select("id");

  if (error) {
    console.error(
      `[post-connected] schedule failed for lead ${leadId}:`,
      error.message,
    );
    return { scheduled: 0, actionIds: [] };
  }

  return {
    scheduled: data?.length ?? 0,
    actionIds: (data ?? []).map((d) => d.id as string),
  };
}

/**
 * Cancel pending post-connected follow-ups for a lead. Use when the lead
 * converts to a matter (already retained — no follow-up needed), is removed,
 * or has been moved to "not a fit".
 */
export async function cancelPostConnectedFollowups(
  admin: SupabaseClient,
  firmId: string,
  leadId: string,
  reason: string,
): Promise<number> {
  const { data, error } = await admin
    .from("scheduled_actions")
    .update({
      status: "cancelled",
      cancelled_reason: reason,
    })
    .eq("firm_id", firmId)
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .filter("metadata->>type", "eq", "post_connected_followup")
    .select("id");
  if (error) {
    console.error(
      `[post-connected] cancel failed for lead ${leadId}:`,
      error.message,
    );
    return 0;
  }
  return data?.length ?? 0;
}
