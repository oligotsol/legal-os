import { formatDistanceToNow } from "date-fns";

export function formatRelativeTime(dateString: string): string {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
}

export function formatDollars(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export type SlaUrgency = "overdue" | "urgent" | "warning" | "normal" | "none";

export function getSlaUrgency(deadline: string | null): SlaUrgency {
  if (!deadline) return "none";

  const now = Date.now();
  const deadlineMs = new Date(deadline).getTime();
  const hoursRemaining = (deadlineMs - now) / (1000 * 60 * 60);

  if (hoursRemaining < 0) return "overdue";
  if (hoursRemaining < 2) return "urgent";
  if (hoursRemaining < 8) return "warning";
  return "normal";
}
