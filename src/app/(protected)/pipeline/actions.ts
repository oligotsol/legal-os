"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeTransition } from "@/lib/pipeline/execute-transition";
import { scheduleDripSequence } from "@/lib/pipeline/drip-scheduler";
import { fetchMatterDetail } from "./queries";
import type { PipelineStage } from "@/types/database";

/**
 * Get the current user's ID and firm ID. Throws if not authenticated or
 * user does not belong to a firm.
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
 * Transition a matter to a new pipeline stage.
 *
 * Extracts matterId, toStageId, and reason from FormData.
 * Validates the transition and executes it via executeTransition().
 */
export async function transitionMatter(formData: FormData) {
  const matterId = formData.get("matterId") as string;
  const toStageId = formData.get("toStageId") as string;
  const reason = formData.get("reason") as string | null;

  if (!matterId) throw new Error("Missing matter ID");
  if (!toStageId) throw new Error("Missing target stage ID");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  // Fetch current matter to get fromStageId
  const { data: matter, error: matterErr } = await admin
    .from("matters")
    .select("stage_id")
    .eq("id", matterId)
    .eq("firm_id", firmId)
    .single();

  if (matterErr || !matter) {
    throw new Error("Matter not found");
  }

  // Fetch all stages for transition validation
  const { data: stages } = await admin
    .from("pipeline_stages")
    .select("*")
    .eq("firm_id", firmId)
    .order("display_order");

  if (!stages || stages.length === 0) {
    throw new Error("No pipeline stages found");
  }

  const result = await executeTransition(
    admin,
    firmId,
    {
      matterId,
      fromStageId: matter.stage_id,
      toStageId,
      actorId: userId,
      reason: reason?.trim() || undefined,
    },
    stages as PipelineStage[],
  );

  if (!result.success) {
    throw new Error(result.error ?? "Transition failed");
  }

  // Schedule drip sequence when entering "awaiting_reply" stage
  const targetStage = (stages as PipelineStage[]).find((s) => s.id === toStageId);
  if (targetStage?.slug === "awaiting_reply") {
    try {
      const { data: matterData } = await admin
        .from("matters")
        .select("lead_id, contact_id")
        .eq("id", matterId)
        .eq("firm_id", firmId)
        .single();

      if (matterData?.lead_id && matterData?.contact_id) {
        // Find the active conversation for this lead
        const { data: conversation } = await admin
          .from("conversations")
          .select("id")
          .eq("firm_id", firmId)
          .eq("lead_id", matterData.lead_id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (conversation) {
          await scheduleDripSequence(
            admin,
            firmId,
            matterData.lead_id,
            matterData.contact_id,
            conversation.id,
            null, // campaign_id — uses AI-generated drips
          );
        }
      }
    } catch (e) {
      // Non-fatal — drip scheduling failure shouldn't block the transition
      console.error("Failed to schedule drip sequence:", e);
    }
  }

  revalidatePath("/pipeline");
}

/**
 * Fetch matter detail data for the detail sheet.
 * This server action is called from client components.
 */
export async function fetchMatterDetailAction(matterId: string) {
  const supabase = await createClient();
  return fetchMatterDetail(supabase, matterId);
}
