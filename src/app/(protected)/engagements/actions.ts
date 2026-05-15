"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateEngagementLetter } from "@/lib/engagement/generate-letter";
import { sendEngagementForSignature } from "@/lib/engagement/send-for-signature";
import { fetchEngagementDetail } from "./queries";

/**
 * Get the current user's ID and firm ID.
 */
async function getActorInfo(): Promise<{ userId: string; firmId: string }> {
  const supabase = await createClient();
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

  return { userId: user.id, firmId: membership.firm_id };
}

/**
 * Generate a new engagement letter from a matter + fee quote, and immediately
 * submit it to the approval queue (mandatory gate per CLAUDE.md §3). Returns
 * the engagement letter ID so the caller can redirect into the detail view.
 *
 * Single-click flow: matter + fee quote -> letter -> pending_approval.
 */
export async function generateLetter(formData: FormData): Promise<string> {
  const matterId = formData.get("matterId") as string;
  const feeQuoteId = formData.get("feeQuoteId") as string;

  if (!matterId) throw new Error("Missing matter ID");
  if (!feeQuoteId) throw new Error("Missing fee quote ID");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  const result = await generateEngagementLetter(admin, {
    firmId,
    matterId,
    feeQuoteId,
    actorId: userId,
  });

  // Auto-submit for approval. Letters never sit in draft after generate —
  // the approval queue is the next checkpoint.
  const { error: updateErr } = await admin
    .from("engagement_letters")
    .update({ status: "pending_approval" })
    .eq("id", result.engagementLetterId)
    .eq("firm_id", firmId);
  if (updateErr) {
    throw new Error(`Failed to set status to pending_approval: ${updateErr.message}`);
  }

  const { error: queueErr } = await admin.from("approval_queue").insert({
    firm_id: firmId,
    entity_type: "engagement_letter",
    entity_id: result.engagementLetterId,
    action_type: "engagement_letter",
    priority: 5,
    status: "pending",
    metadata: {
      matter_id: matterId,
      fee_quote_id: feeQuoteId,
    },
  });
  if (queueErr) {
    throw new Error(`Failed to create approval queue entry: ${queueErr.message}`);
  }

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "engagement_letter.submitted_for_approval",
    p_entity_type: "engagement_letter",
    p_entity_id: result.engagementLetterId,
    p_before: { status: "draft" },
    p_after: { status: "pending_approval" },
    p_metadata: null,
  });

  revalidatePath("/engagements");
  revalidatePath("/pipeline");
  revalidatePath("/approvals");

  return result.engagementLetterId;
}

/**
 * Submit a draft engagement letter for attorney approval.
 * Creates an approval_queue entry (mandatory gate).
 */
export async function submitForApproval(formData: FormData): Promise<void> {
  const engagementLetterId = formData.get("engagementLetterId") as string;
  if (!engagementLetterId) throw new Error("Missing engagement letter ID");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  // Verify letter exists and is in draft status
  const { data: letter, error: letterErr } = await admin
    .from("engagement_letters")
    .select("status")
    .eq("id", engagementLetterId)
    .eq("firm_id", firmId)
    .single();

  if (letterErr || !letter) {
    throw new Error("Engagement letter not found");
  }

  if (letter.status !== "draft") {
    throw new Error(`Cannot submit: letter is already ${letter.status}`);
  }

  // Update status to pending_approval
  const { error: updateErr } = await admin
    .from("engagement_letters")
    .update({ status: "pending_approval" })
    .eq("id", engagementLetterId)
    .eq("firm_id", firmId);

  if (updateErr) {
    throw new Error(`Failed to update status: ${updateErr.message}`);
  }

  // Create approval queue entry (mandatory gate for engagement letters)
  const { error: queueErr } = await admin.from("approval_queue").insert({
    firm_id: firmId,
    entity_type: "engagement_letter",
    entity_id: engagementLetterId,
    action_type: "engagement_letter",
    priority: 5,
    status: "pending",
  });

  if (queueErr) {
    throw new Error(`Failed to create approval queue entry: ${queueErr.message}`);
  }

  // Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "engagement_letter.submitted_for_approval",
    p_entity_type: "engagement_letter",
    p_entity_id: engagementLetterId,
    p_before: { status: "draft" },
    p_after: { status: "pending_approval" },
    p_metadata: null,
  });

  revalidatePath("/engagements");
  revalidatePath("/approvals");
}

/**
 * Send an approved engagement letter for e-signature.
 * Verifies the letter is approved before sending (mandatory gate).
 */
export async function sendForSignature(formData: FormData): Promise<void> {
  const engagementLetterId = formData.get("engagementLetterId") as string;
  if (!engagementLetterId) throw new Error("Missing engagement letter ID");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  await sendEngagementForSignature(admin, {
    firmId,
    engagementLetterId,
    actorId: userId,
  });

  revalidatePath("/engagements");
  revalidatePath("/pipeline");
}

/**
 * Fetch engagement letter detail for the detail sheet.
 */
export async function fetchEngagementDetailAction(id: string) {
  const supabase = await createClient();
  return fetchEngagementDetail(supabase, id);
}
