/**
 * Approval mode configuration.
 *
 * Determines whether an action requires attorney/owner review or is auto-approved.
 *
 * HARD CONSTRAINT (CLAUDE.md non-negotiable #3): action types flagged as
 * `mandatory_review=true` in `vertical_action_types` ALWAYS require approval
 * regardless of firm-level config. For the legal vertical that's fee_quote,
 * engagement_letter, invoice. For roofing it would be quote, contract,
 * change_order, invoice. The list lives in DB so each vertical defines its
 * own non-bypassable gates.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { ApprovalActionType } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalMode = "always_review" | "auto_approve";

// ---------------------------------------------------------------------------
// Fetch approval mode for a firm + action type
// ---------------------------------------------------------------------------

/**
 * Returns the approval mode for a given firm and action type.
 *
 * Flow:
 *   1. Look up the firm's vertical and the action_type's `mandatory_review`
 *      flag in `vertical_action_types`. If true → always_review (hard gate).
 *   2. Otherwise read `firm_config.approval_mode[action_type]`. Default to
 *      always_review.
 */
export async function getApprovalMode(
  firmId: string,
  actionType: ApprovalActionType,
): Promise<ApprovalMode> {
  const admin = createAdminClient();

  // Resolve firm vertical, then check the per-vertical mandatory_review flag.
  const { data: firm } = await admin
    .from("firms")
    .select("vertical")
    .eq("id", firmId)
    .maybeSingle();

  if (firm?.vertical) {
    const { data: actionRow } = await admin
      .from("vertical_action_types")
      .select("mandatory_review")
      .eq("vertical", firm.vertical)
      .eq("action_type", actionType)
      .maybeSingle();
    if (actionRow?.mandatory_review === true) {
      return "always_review";
    }
  }

  // Otherwise consult firm-level approval_mode config.
  const { data: cfg } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", "approval_mode")
    .maybeSingle();

  if (!cfg) return "always_review";

  const config = cfg.value as Record<string, string>;
  const mode = config[actionType];

  if (mode === "auto_approve") return "auto_approve";
  return "always_review";
}

/**
 * Async check for mandatory review action types. Hits `vertical_action_types`.
 * Use the sync `isMandatoryReviewLegacy` only in code paths where you already
 * know the firm is on the legal vertical and a DB call is undesirable.
 */
export async function isMandatoryReview(
  firmId: string,
  actionType: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data: firm } = await admin
    .from("firms")
    .select("vertical")
    .eq("id", firmId)
    .maybeSingle();
  if (!firm?.vertical) return false;
  const { data } = await admin
    .from("vertical_action_types")
    .select("mandatory_review")
    .eq("vertical", firm.vertical)
    .eq("action_type", actionType)
    .maybeSingle();
  return data?.mandatory_review === true;
}
