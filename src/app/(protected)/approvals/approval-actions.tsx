"use client";

import { useState, useTransition } from "react";
import { Send, X, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  approveItem,
  rejectItem,
  editAndApproveItem,
  redraftMessageAction,
} from "./actions";

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
  const isMessage = entityType === "message" && initialContent !== undefined;

  const [content, setContent] = useState(initialContent ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [redraftOpen, setRedraftOpen] = useState(false);
  const [redraftInstructions, setRedraftInstructions] = useState("");
  const [redraftPending, startRedraftTransition] = useTransition();
  const [redraftNote, setRedraftNote] = useState<string | null>(null);

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
          const fd = new FormData();
          fd.set("queueItemId", queueItemId);
          fd.set("editedContent", content);
          await editAndApproveItem(fd);
        } else {
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

  function handleRedraft() {
    setRedraftNote(null);
    setError(null);
    const instructions = redraftInstructions.trim();
    if (!instructions) {
      setError("Tell the AI what to change");
      return;
    }

    const fd = new FormData();
    fd.set("queueItemId", queueItemId);
    fd.set("instructions", instructions);

    startRedraftTransition(async () => {
      try {
        const { content: newContent } = await redraftMessageAction(fd);
        setContent(newContent);
        setRedraftNote(`Updated by AI based on: "${instructions}"`);
        setRedraftInstructions("");
        setRedraftOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Redraft failed");
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

  // ----- Messages: editable textarea + Send Reply / AI Redraft / Reject -----
  if (isMessage) {
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI draft — edit before sending if needed
          </label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="rounded-md border-2 border-primary/20 bg-background text-[15px] leading-relaxed shadow-inner focus:border-primary/40 focus-visible:ring-primary/30"
            placeholder="Reply..."
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {redraftNote ??
              (isEdited
                ? "Edited — your version will be sent and the diff recorded."
                : "Unchanged — clicking Send will dispatch the AI's draft as-is.")}
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={handleSend}
            disabled={isPending || !content.trim()}
            className="flex-1 min-w-[140px]"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {isPending
              ? "Sending..."
              : isEdited
                ? "Send Edited Reply"
                : "Send Reply"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setError(null);
              setRedraftOpen(true);
            }}
            disabled={isPending || redraftPending}
            className="gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-sm shadow-violet-500/30 ring-1 ring-violet-400/40 transition-shadow hover:from-violet-700 hover:to-fuchsia-600 hover:shadow-md hover:shadow-violet-500/40 focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5 animate-soft-pulse" />
            AI Redraft
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

        <Dialog open={redraftOpen} onOpenChange={setRedraftOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Redraft with AI
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                What would you like to change about the message?
              </p>
              <Textarea
                value={redraftInstructions}
                onChange={(e) => setRedraftInstructions(e.target.value)}
                rows={4}
                placeholder={`e.g. "Make it shorter and don't mention payment yet" or "Reference that we handle estate planning, not the broader inquiry"`}
                disabled={redraftPending}
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleRedraft();
                  }
                }}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRedraftOpen(false)}
                  disabled={redraftPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRedraft}
                  disabled={redraftPending || !redraftInstructions.trim()}
                  className="gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {redraftPending ? "Redrafting..." : "Redraft"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ----- Non-message types: simple Approve / Reject -----
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
