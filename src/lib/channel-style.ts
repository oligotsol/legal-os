/**
 * Shared visual vocabulary for communication channels. Used across
 * conversations, message bubbles, and approval cards so that channel
 * identity is recognizable at a glance.
 */

export const CHANNEL_RIBBON_CLASSES: Record<string, string> = {
  sms: "bg-gradient-to-b from-[oklch(0.55_0.12_265)] to-[oklch(0.55_0.12_265/0.5)]",
  email:
    "bg-gradient-to-b from-[oklch(0.65_0.15_175)] to-[oklch(0.65_0.15_175/0.5)]",
  voice: "bg-gradient-to-b from-[oklch(0.70_0.15_75)] to-[oklch(0.70_0.15_75/0.5)]",
};

export const CHANNEL_BADGE_CLASSES: Record<string, string> = {
  sms: "bg-[oklch(0.55_0.12_265/0.1)] text-[oklch(0.37_0.12_265)]",
  email: "bg-[oklch(0.65_0.15_175/0.1)] text-[oklch(0.40_0.10_175)]",
  voice: "bg-[oklch(0.70_0.15_75/0.1)] text-[oklch(0.45_0.12_75)]",
};

export const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  voice: "Voice",
};

export function ribbonForChannel(channel: string | null | undefined): string {
  if (!channel) return CHANNEL_RIBBON_CLASSES.sms;
  return CHANNEL_RIBBON_CLASSES[channel] ?? CHANNEL_RIBBON_CLASSES.sms;
}
