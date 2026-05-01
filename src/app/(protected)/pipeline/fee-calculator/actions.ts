"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Save a fee quote for a matter. Creates the fee_quote row with
 * status "pending_approval" and enqueues it in the approval_queue
 * (fee_quote actions always require attorney approval).
 *
 * Returns the newly created quote ID.
 */
export async function saveFeeQuote(formData: FormData) {
  const supabase = await createClient();

  // Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    throw new Error("User does not belong to a firm");
  }

  const firmId = membership.firm_id;
  const matterId = formData.get("matter_id") as string;
  const contactId = (formData.get("contact_id") as string) || null;
  const lineItemsJson = formData.get("line_items") as string;
  const subtotal = Number(formData.get("subtotal"));
  const bundleDiscount = Number(formData.get("bundle_discount"));
  const engagementTierDiscount = Number(
    formData.get("engagement_tier_discount")
  );
  const totalQuotedFee = Number(formData.get("total_quoted_fee"));
  const floorTotal = Number(formData.get("floor_total"));

  if (!matterId) {
    throw new Error("Matter ID is required to save a fee quote");
  }

  const lineItems = JSON.parse(lineItemsJson);

  // Insert the fee quote
  const { data: feeQuote, error: quoteError } = await supabase
    .from("fee_quotes")
    .insert({
      firm_id: firmId,
      matter_id: matterId,
      contact_id: contactId,
      line_items: lineItems,
      subtotal,
      bundle_discount: bundleDiscount,
      engagement_tier_discount: engagementTierDiscount,
      total_quoted_fee: totalQuotedFee,
      floor_total: floorTotal,
      status: "pending_approval",
    })
    .select("id")
    .single();

  if (quoteError || !feeQuote) {
    throw new Error(quoteError?.message ?? "Failed to create fee quote");
  }

  // Enqueue for approval — fee_quote is a hard-gated approval type
  const { error: approvalError } = await supabase
    .from("approval_queue")
    .insert({
      firm_id: firmId,
      entity_type: "fee_quote",
      entity_id: feeQuote.id,
      action_type: "fee_quote",
      priority: 1,
      status: "pending",
      assigned_to: user.id,
      metadata: {
        matter_id: matterId,
        total_quoted_fee: totalQuotedFee,
      },
    });

  if (approvalError) {
    throw new Error(approvalError.message ?? "Failed to enqueue for approval");
  }

  // Audit log — fee_quote.created
  const admin = createAdminClient();
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: user.id,
    p_action: "fee_quote.created",
    p_entity_type: "fee_quote",
    p_entity_id: feeQuote.id,
    p_before: null,
    p_after: { status: "pending_approval", total_quoted_fee: totalQuotedFee },
  });

  revalidatePath("/pipeline");
  revalidatePath("/approvals");

  return feeQuote.id;
}
