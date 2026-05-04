import type { ApprovalActionType } from "@/types/database";

export const ACTION_TYPE_LABELS: Record<ApprovalActionType, string> = {
  message: "Message",
  fee_quote: "Fee Quote",
  engagement_letter: "Engagement Letter",
  invoice: "Invoice",
  other: "Other",
};

export const ACTION_TYPE_BADGE_CLASSES: Record<ApprovalActionType, string> = {
  message:
    "bg-[oklch(0.55_0.12_265/0.1)] text-[oklch(0.37_0.12_265)]",
  fee_quote:
    "bg-[oklch(0.65_0.15_175/0.1)] text-[oklch(0.40_0.10_175)]",
  engagement_letter:
    "bg-[oklch(0.60_0.15_305/0.1)] text-[oklch(0.40_0.12_305)]",
  invoice:
    "bg-[oklch(0.70_0.15_75/0.1)] text-[oklch(0.45_0.12_75)]",
  other:
    "bg-[oklch(0.55_0.02_265/0.1)] text-[oklch(0.45_0.02_265)]",
};

/**
 * Left-edge accent ribbon for approval cards. Same hue family as the
 * badge but rendered as a vertical gradient stripe so cards read as
 * categorized at a glance.
 */
export const ACTION_TYPE_RIBBON_CLASSES: Record<ApprovalActionType, string> = {
  message:
    "bg-gradient-to-b from-[oklch(0.55_0.12_265)] to-[oklch(0.55_0.12_265/0.5)]",
  fee_quote:
    "bg-gradient-to-b from-[oklch(0.65_0.15_175)] to-[oklch(0.65_0.15_175/0.5)]",
  engagement_letter:
    "bg-gradient-to-b from-[oklch(0.60_0.15_305)] to-[oklch(0.60_0.15_305/0.5)]",
  invoice:
    "bg-gradient-to-b from-[oklch(0.70_0.15_75)] to-[oklch(0.70_0.15_75/0.5)]",
  other:
    "bg-gradient-to-b from-[oklch(0.55_0.02_265)] to-[oklch(0.55_0.02_265/0.5)]",
};
