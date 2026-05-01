import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import type { ThreadMessage } from "./queries";

interface MessageBubbleProps {
  message: ThreadMessage;
}

const STATUS_BADGE_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  draft: "outline",
  pending_approval: "secondary",
  approved: "secondary",
  sent: "default",
  delivered: "default",
  failed: "destructive",
  rejected: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  rejected: "Rejected",
};

const SENDER_TYPE_LABELS: Record<string, string> = {
  contact: "Contact",
  ai: "AI",
  attorney: "Attorney",
  system: "System",
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isInbound = message.direction === "inbound";

  return (
    <div
      className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`
          max-w-[80%] rounded-lg px-3 py-2
          ${isInbound
            ? "bg-muted text-foreground"
            : "bg-primary/10 text-foreground"
          }
        `}
      >
        {message.content && (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        )}

        <div
          className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${
            isInbound ? "" : "justify-end"
          }`}
        >
          <span className="text-[10px] text-muted-foreground">
            {SENDER_TYPE_LABELS[message.senderType] ?? message.senderType}
          </span>

          {message.aiGenerated && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[9px] font-semibold"
            >
              AI
            </Badge>
          )}

          {!isInbound && message.status && (
            <Badge
              variant={STATUS_BADGE_VARIANT[message.status] ?? "outline"}
              className="h-4 px-1 text-[9px]"
            >
              {STATUS_LABELS[message.status] ?? message.status}
            </Badge>
          )}

          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
