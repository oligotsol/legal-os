import { validateTransition, type TransitionRequest, type GateContext } from "./transitions";
import type { PipelineStage } from "@/types/database";

/**
 * Execute a pipeline stage transition.
 *
 * 1. Validate the transition
 * 2. Update matter.stage_id
 * 3. Insert matter_stage_history record
 * 4. Audit log
 *
 * @param admin - Supabase admin client
 * @param firmId - Firm ID for tenant scoping
 * @param request - Transition request
 * @param stages - All pipeline stages for validation
 * @param gateContext - Optional gate context for stage-specific checks
 */
export async function executeTransition(
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  firmId: string,
  request: TransitionRequest,
  stages: PipelineStage[],
  gateContext: GateContext = {},
): Promise<{ success: boolean; error?: string }> {
  // Validate
  const validation = validateTransition(request, stages, gateContext);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Update matter stage
  const { error: updateErr } = await admin
    .from("matters")
    .update({ stage_id: request.toStageId, updated_at: new Date().toISOString() })
    .eq("id", request.matterId)
    .eq("firm_id", firmId);

  if (updateErr) {
    return { success: false, error: `Failed to update matter stage: ${updateErr.message}` };
  }

  // Insert stage history
  const { error: historyErr } = await admin.from("matter_stage_history").insert({
    firm_id: firmId,
    matter_id: request.matterId,
    from_stage_id: request.fromStageId,
    to_stage_id: request.toStageId,
    actor_id: request.actorId,
    reason: request.reason ?? null,
  });

  if (historyErr) {
    console.error("Failed to insert stage history:", historyErr.message);
    // Non-fatal — the stage was already updated
  }

  // Audit log (uses RPC for hash-chain computation)
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const fromSlug = request.fromStageId ? stageMap.get(request.fromStageId)?.slug : null;
  const toSlug = stageMap.get(request.toStageId)?.slug;

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: request.actorId,
    p_action: "pipeline.stage_transition",
    p_entity_type: "matter",
    p_entity_id: request.matterId,
    p_before: fromSlug ? { stage: fromSlug } : null,
    p_after: { stage: toSlug },
    p_metadata: { reason: request.reason ?? null },
  });

  return { success: true };
}
