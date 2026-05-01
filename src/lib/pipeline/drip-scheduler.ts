/**
 * Schedule a Day 2/5/7/10 drip follow-up sequence.
 *
 * Called when a lead enters the AWAITING_REPLY pipeline stage.
 * Inserts 4 scheduled_actions at the appropriate day offsets.
 */

type AdminClient = ReturnType<
  typeof import("@/lib/supabase/admin").createAdminClient
>;

const DRIP_DAY_OFFSETS = [2, 5, 7, 10];

export async function scheduleDripSequence(
  admin: AdminClient,
  firmId: string,
  leadId: string,
  contactId: string,
  conversationId: string,
  campaignId: string | null,
): Promise<{ scheduledCount: number; actionIds: string[] }> {
  const now = new Date();
  const actions = DRIP_DAY_OFFSETS.map((day) => {
    const scheduledFor = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
    return {
      firm_id: firmId,
      campaign_id: campaignId,
      template_id: null, // AI-generated, not template-based
      matter_id: null,
      lead_id: leadId,
      contact_id: contactId,
      scheduled_for: scheduledFor.toISOString(),
      status: "pending" as const,
      metadata: {
        drip_day: day,
        conversation_id: conversationId,
        type: "ai_drip",
      },
    };
  });

  const { data, error } = await admin
    .from("scheduled_actions")
    .insert(actions)
    .select("id");

  if (error) {
    throw new Error(`Failed to schedule drip sequence: ${error.message}`);
  }

  return {
    scheduledCount: data?.length ?? 0,
    actionIds: (data ?? []).map((d) => d.id),
  };
}
