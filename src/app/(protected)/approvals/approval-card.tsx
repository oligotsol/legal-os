"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ACTION_TYPE_LABELS,
  ACTION_TYPE_BADGE_CLASSES,
} from "@/lib/approval-labels";
import { formatRelativeTime, getSlaUrgency } from "@/lib/format";
import { approveItem } from "./actions";
import type { EnrichedQueueItem } from "./queries";

interface ApprovalCardProps {
  item: EnrichedQueueItem;
}

const SLA_DOT_CLASSES = {
  overdue: "bg-red-500 animate-pulse",
  urgent: "bg-red-500 animate-pulse",
  warning: "bg-amber-500",
  normal: "bg-emerald-500",
  none: "hidden",
} as const;

export function ApprovalCard({ item }: ApprovalCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const urgency = getSlaUrgency(item.sla_deadline);

  const isSelected = searchParams.get("item") === item.id;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("item", item.id);
    router.push(`/approvals?${params.toString()}`);
  }

  function handleQuickApprove(e: React.MouseEvent) {
    e.stopPropagation();
    const formData = new FormData();
    formData.set("queueItemId", item.id);
    startTransition(() => {
      approveItem(formData);
    });
  }

  return (
    <button
      onClick={handleClick}
      className={`
        group w-full rounded-lg border bg-card p-4 text-left transition-all duration-150
        ring-1 ring-foreground/10 hover:ring-foreground/20 hover:shadow-sm
        ${isSelected ? "ring-primary/40 shadow-sm" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={`text-xs font-medium ${ACTION_TYPE_BADGE_CLASSES[item.action_type]}`}
            >
              {ACTION_TYPE_LABELS[item.action_type]}
            </Badge>
            <span
              className={`h-2 w-2 rounded-full ${SLA_DOT_CLASSES[urgency]}`}
              title={urgency !== "none" ? `SLA: ${urgency}` : undefined}
            />
          </div>

          {item.entity_summary && (
            <p className="mt-2 text-sm font-medium text-card-foreground line-clamp-2">
              {item.entity_summary}
            </p>
          )}

          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            {item.contact_name && <span>{item.contact_name}</span>}
            {item.contact_name && <span>&middot;</span>}
            <span>{formatRelativeTime(item.created_at)}</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={handleQuickApprove}
          disabled={isPending}
        >
          <Check className="mr-1 h-3.5 w-3.5" />
          {isPending ? "..." : "Approve"}
        </Button>
      </div>
    </button>
  );
}
