/**
 * Cancel pending drip actions when a lead replies.
 *
 * Sets all pending scheduled_actions for a given lead/contact to "cancelled"
 * with reason "inbound_reply_received".
 */

type AdminClient = ReturnType<
  typeof import("@/lib/supabase/admin").createAdminClient
>;

export async function cancelPendingDrips(
  admin: AdminClient,
  firmId: string,
  leadId: string | null,
  contactId: string,
): Promise<number> {
  // Cancel by contact_id (primary) — covers all drips for this contact
  const query = admin
    .from("scheduled_actions")
    .update({
      status: "cancelled",
      cancelled_reason: "inbound_reply_received",
    })
    .eq("firm_id", firmId)
    .eq("contact_id", contactId)
    .eq("status", "pending");

  const { data, error } = await query.select("id");

  if (error) {
    console.error("Failed to cancel pending drips:", error.message);
    return 0;
  }

  return data?.length ?? 0;
}
