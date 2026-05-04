"use client";

import { useState, useTransition } from "react";
import { Send, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveItem, rejectItem, editAndApproveItem } from "./actions";

interface ApprovalActionsProps {
  queueItemId: string;
  initialContent?: string;
  /** Drives label wording: "Send Reply" for messages vs "Approve" for fee_quote / engagement_letter / invoice. */
  entityType?: string;
}

export function ApprovalActions({
  queueItemId,
  initialContent,
  entityType,
}: ApprovalActionsProps) {
  // For messages we render the AI draft inline as an editable textarea so
  // the attorney sees and can change wording before clicking Send. For
  // non-message types we keep the simple Approve button.
  const isMessage = entityType === "message" && initialContent !== undefined;

  const [content, setContent] = useState(initialContent ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEdited =
    isMessage && content.trim() !== (initialContent ?? "").trim();

  function handleSend() {
    setError(null);
    if (isMessage && !content.trim()) {
      setError("Message cannot be empty");
      return;
    }

    startTransition(async () => {
      try {
        if (isMessage && isEdited) {
          // Content was edited — record an edited_and_approved decision
          // with the diff captured.
          const fd = new FormData();
          fd.set("queueItemId", queueItemId);
          fd.set("editedContent", content);
          await editAndApproveItem(fd);
        } else {
          // Plain approve — send unchanged.
          const fd = new FormData();
          fd.set("queueItemId", queueItemId);
          await approveItem(fd);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      }
    });
  }

  function handleReject() {
    setError(null);
    const fd = new FormData();
    fd.set("queueItemId", queueItemId);
    fd.set("reason", rejectReason);
    startTransition(async () => {
      try {
        await rejectItem(fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rejection failed");
      }
    });
  }

  if (rejecting) {
    return (
      <div className="space-y-3">
        <Textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
          className="text-sm"
          placeholder="Reason for rejection (required)..."
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleReject}
            disabled={isPending || !rejectReason.trim()}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            {isPending ? "Rejecting..." : "Confirm Rejection"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRejecting(false);
              setError(null);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ----- Messages: editable textarea + Send Reply -----
  if (isMessage) {
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            AI draft — edit before sending if needed
          </label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="text-sm leading-relaxed"
            placeholder="Reply..."
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {isEdited
              ? "Edited — your version will be sent and the diff recorded."
              : "Unchanged — clicking Send will dispatch the AI's draft as-is."}
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSend}
            disabled={isPending || !content.trim()}
            className="flex-1"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {isPending
              ? "Sending..."
              : isEdited
                ? "Send Edited Reply"
                : "Send Reply"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRejecting(true)}
            disabled={isPending}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      </div>
    );
  }

  // ----- Non-message types (fee_quote / engagement_letter / invoice): keep the simple Approve / Reject -----
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSend} disabled={isPending}>
          <Check className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? "Approving..." : "Approve"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRejecting(true)}
          disabled={isPending}
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Reject
        </Button>
      </div>
    </div>
  );
}
