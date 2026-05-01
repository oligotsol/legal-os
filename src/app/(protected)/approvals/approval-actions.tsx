"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveItem, rejectItem, editAndApproveItem } from "./actions";

interface ApprovalActionsProps {
  queueItemId: string;
  initialContent?: string;
}

type Mode = "default" | "edit" | "reject";

export function ApprovalActions({
  queueItemId,
  initialContent,
}: ApprovalActionsProps) {
  const [mode, setMode] = useState<Mode>("default");
  const [editedContent, setEditedContent] = useState(initialContent ?? "");
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    setError(null);
    const formData = new FormData();
    formData.set("queueItemId", queueItemId);
    startTransition(async () => {
      try {
        await approveItem(formData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Approval failed");
      }
    });
  }

  function handleReject() {
    setError(null);
    const formData = new FormData();
    formData.set("queueItemId", queueItemId);
    formData.set("reason", rejectReason);
    startTransition(async () => {
      try {
        await rejectItem(formData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rejection failed");
      }
    });
  }

  function handleEditAndApprove() {
    setError(null);
    const formData = new FormData();
    formData.set("queueItemId", queueItemId);
    formData.set("editedContent", editedContent);
    startTransition(async () => {
      try {
        await editAndApproveItem(formData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Edit & approve failed");
      }
    });
  }

  if (mode === "edit") {
    return (
      <div className="space-y-3">
        <Textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          rows={6}
          className="text-sm"
          placeholder="Edit the content before approving..."
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleEditAndApprove}
            disabled={isPending || !editedContent.trim()}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {isPending ? "Saving..." : "Save & Approve"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode("default");
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

  if (mode === "reject") {
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
              setMode("default");
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

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleApprove} disabled={isPending}>
          <Check className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? "Approving..." : "Approve"}
        </Button>
        {initialContent !== undefined && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode("edit")}
            disabled={isPending}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit & Approve
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMode("reject")}
          disabled={isPending}
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Reject
        </Button>
      </div>
    </div>
  );
}
