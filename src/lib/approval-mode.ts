/**
 * Approval mode configuration.
 *
 * Determines whether an action requires attorney review or is auto-approved.
 *
 * HARD CONSTRAINT (CLAUDE.md non-negotiable #3): fee_quote, engagement_letter,
 * and invoice ALWAYS require approval regardless of config. These gates cannot
 * be bypassed.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { ApprovalActionType } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalMode = "always_review" | "auto_approve";

/** Action types that MUST always require review — hard-coded gate. */
const MANDATORY_REVIEW_ACTIONS: ReadonlySet<string> = new Set([
  "fee_quote",
  "engagement_letter",
  "invoice",
]);

// ---------------------------------------------------------------------------
// Fetch approval mode for a firm + action type
// ---------------------------------------------------------------------------

/**
 * Returns the approval mode for a given firm and action type.
 *
 * - fee_quote, engagement_letter, invoice → always "always_review" (non-negotiable)
 * - message, other → checks firm_config "approval_mode" key, defaults to "always_review"
 */
export async function getApprovalMode(
  firmId: string,
  actionType: ApprovalActionType,
): Promise<ApprovalMode> {
  // Hard gate — these three always require review
  if (MANDATORY_REVIEW_ACTIONS.has(actionType)) {
    return "always_review";
  }

  const admin = createAdminClient();

  const { data } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", "approval_mode")
    .maybeSingle();

  if (!data) return "always_review";

  const config = data.value as Record<string, string>;
  const mode = config[actionType];

  if (mode === "auto_approve") return "auto_approve";
  return "always_review";
}

/**
 * Synchronous check for mandatory review actions.
 * Use this when you already know the action type and want to skip the DB call.
 */
export function isMandatoryReview(actionType: string): boolean {
  return MANDATORY_REVIEW_ACTIONS.has(actionType);
}
