import type { PipelineStage } from "@/types/database";

// ---------------------------------------------------------------------------
// SLA Color Computation
// ---------------------------------------------------------------------------

export type SlaColor = "GREEN" | "YELLOW" | "ORANGE" | "RED" | "CRITICAL" | "NONE";

/**
 * Compute SLA color based on elapsed time vs SLA hours.
 * Returns NONE if slaHours is null (no SLA defined).
 */
export function computeSlaColor(
  stageEnteredAt: string | Date,
  slaHours: number | null,
): SlaColor {
  if (slaHours == null) return "NONE";

  const enteredMs = new Date(stageEnteredAt).getTime();
  const nowMs = Date.now();
  const elapsedHours = (nowMs - enteredMs) / (1000 * 60 * 60);
  const ratio = elapsedHours / slaHours;

  if (ratio >= 1.5) return "CRITICAL";
  if (ratio >= 1.0) return "RED";
  if (ratio >= 0.75) return "ORANGE";
  if (ratio >= 0.5) return "YELLOW";
  return "GREEN";
}

// ---------------------------------------------------------------------------
// Transition Validation
// ---------------------------------------------------------------------------

export interface TransitionRequest {
  matterId: string;
  fromStageId: string | null;
  toStageId: string;
  actorId: string | null;
  reason?: string;
}

export interface GateContext {
  ethicsScanClean?: boolean;
  jurisdictionLocked?: boolean;
  dropboxSignConfirmed?: boolean;
}

export interface TransitionValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate a pipeline stage transition.
 *
 * Checks:
 * 1. Target stage exists
 * 2. Source is not terminal
 * 3. Target is in source's allowed_transitions
 * 4. Stage-specific gates
 */
export function validateTransition(
  request: TransitionRequest,
  stages: PipelineStage[],
  gateContext: GateContext = {},
): TransitionValidation {
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  const toStage = stageMap.get(request.toStageId);
  if (!toStage) {
    return { valid: false, error: "Target stage not found" };
  }

  // If fromStageId is null, this is initial assignment (always allowed)
  if (request.fromStageId == null) {
    return { valid: true };
  }

  const fromStage = stageMap.get(request.fromStageId);
  if (!fromStage) {
    return { valid: false, error: "Source stage not found" };
  }

  // Terminal stages cannot transition out
  if (fromStage.is_terminal) {
    return { valid: false, error: `Cannot transition from terminal stage "${fromStage.slug}"` };
  }

  // Check allowed transitions
  if (!fromStage.allowed_transitions.includes(request.toStageId)) {
    return {
      valid: false,
      error: `Transition from "${fromStage.slug}" to "${toStage.slug}" is not allowed`,
    };
  }

  // Stage-specific gates
  if (toStage.slug === "fee_quoted" && gateContext.ethicsScanClean === false) {
    return { valid: false, error: "Cannot quote fee: ethics scan flagged issues" };
  }

  if (toStage.slug === "engagement_sent" && gateContext.jurisdictionLocked === false) {
    return { valid: false, error: "Cannot send engagement: jurisdiction not locked" };
  }

  if (toStage.slug === "paid_awaiting_intake" && gateContext.dropboxSignConfirmed === false) {
    return { valid: false, error: "Cannot mark paid: Dropbox Sign confirmation pending" };
  }

  return { valid: true };
}
