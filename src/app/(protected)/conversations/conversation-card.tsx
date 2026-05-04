"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import {
  CHANNEL_BADGE_CLASSES,
  CHANNEL_LABELS,
  ribbonForChannel,
} from "@/lib/channel-style";
import type { ConversationListItem } from "./queries";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500 animate-soft-pulse",
  paused: "bg-yellow-500",
  escalated: "bg-red-500 animate-soft-pulse",
  closed: "bg-gray-400",
};

const PHASE_LABELS: Record<string, string> = {
  initial_contact: "Initial Contact",
  qualification: "Qualification",
  scheduling: "Scheduling",
  follow_up: "Follow Up",
  negotiation: "Negotiation",
  closing: "Closing",
};

interface ConversationCardProps {
  conversation: ConversationListItem;
}

export function ConversationCard({ conversation }: ConversationCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isSelected = searchParams.get("id") === conversation.id;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", conversation.id);
    router.push(`/conversations?${params.toString()}`);
  }

  const statusColor = STATUS_COLORS[conversation.status] ?? "bg-gray-400";
  const phaseLabel = PHASE_LABELS[conversation.phase] ?? conversation.phase;

  return (
    <button
      onClick={handleClick}
      className={`
        group relative w-full overflow-hidden rounded-lg border bg-card p-4 pl-5 text-left
        ring-1 ring-foreground/10 transition-all duration-200 ease-out
        hover:-translate-y-px hover:shadow-md hover:shadow-foreground/5 hover:ring-foreground/20
        ${isSelected ? "ring-primary/50 shadow-md shadow-primary/5" : ""}
      `}
    >
      {/* Channel-coded ribbon */}
      <span
        aria-hidden
        className={`
          absolute inset-y-0 left-0 w-1
          ${ribbonForChannel(conversation.channel)}
          ${isSelected ? "opacity-100" : "opacity-70 group-hover:opacity-100"}
          transition-opacity duration-200
        `}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-card-foreground">
              {conversation.contactName}
            </span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`}
              title={conversation.status}
            />
            {conversation.channel && (
              <Badge
                variant="secondary"
                className={`text-[10px] font-medium ${CHANNEL_BADGE_CLASSES[conversation.channel] ?? ""}`}
              >
                {CHANNEL_LABELS[conversation.channel] ?? conversation.channel.toUpperCase()}
              </Badge>
            )}
            {conversation.hasEthicsFlags && (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500 animate-soft-pulse" />
            )}
          </div>

          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-normal">
              {phaseLabel}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {conversation.messageCount} message{conversation.messageCount !== 1 ? "s" : ""}
            </span>
          </div>

          {conversation.lastMessagePreview && (
            <p className="mt-1.5 truncate text-xs italic text-muted-foreground">
              {conversation.lastMessagePreview}
            </p>
          )}

          {conversation.lastMessageAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelativeTime(conversation.lastMessageAt)}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
