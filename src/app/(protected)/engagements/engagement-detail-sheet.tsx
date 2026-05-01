"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDollars, formatRelativeTime } from "@/lib/format";
import {
  fetchEngagementDetailAction,
  submitForApproval,
  sendForSignature,
} from "./actions";
import type { EngagementDetail } from "./queries";

// ---------------------------------------------------------------------------
// Status timeline
// ---------------------------------------------------------------------------

const STATUS_STEPS = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "signed",
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  sent: "Sent for Signature",
  viewed: "Viewed",
  signed: "Signed",
  declined: "Declined",
  expired: "Expired",
};

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.indexOf(status as typeof STATUS_STEPS[number]);
  return idx >= 0 ? idx : -1;
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export function EngagementDetailSheet() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const engagementId = searchParams.get("id");

  const [detail, setDetail] = useState<EngagementDetail | null>(null);
  const [isLoading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!engagementId) {
      setDetail(null);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await fetchEngagementDetailAction(engagementId);
        setDetail(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    });
  }, [engagementId]);

  function handleClose() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("id");
    router.push(`/engagements?${params.toString()}`);
  }

  return (
    <Sheet open={!!engagementId} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {isLoading && <DetailSkeleton />}

        {error && (
          <div className="py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && detail && (
          <DetailContent detail={detail} />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Detail Content
// ---------------------------------------------------------------------------

function DetailContent({ detail }: { detail: EngagementDetail }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-base font-medium">
          {detail.contactName}
        </SheetTitle>
        {detail.contactEmail && (
          <p className="text-sm text-muted-foreground">{detail.contactEmail}</p>
        )}
      </SheetHeader>

      {/* Status + Matter info */}
      <div className="px-4 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs capitalize">
            {detail.matterType?.replace(/_/g, " ") ?? "N/A"}
          </Badge>
          {detail.stateCode && (
            <Badge variant="secondary" className="text-xs">
              {detail.stateCode}
            </Badge>
          )}
        </div>
      </div>

      <Separator className="mx-4" />

      {/* Status Timeline */}
      <div className="px-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Status
        </h3>
        <StatusTimeline status={detail.status} />
      </div>

      <Separator className="mx-4" />

      {/* Fee Quote Summary */}
      {detail.feeQuote && (
        <>
          <div className="px-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Fee Quote
            </h3>
            <div className="space-y-1 text-sm">
              {detail.feeQuote.lineItems.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted-foreground">{item.serviceName}</span>
                  <span className="tabular-nums">{formatDollars(item.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between font-medium pt-1 border-t">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatDollars(detail.feeQuote.totalQuotedFee)}
                </span>
              </div>
            </div>
          </div>
          <Separator className="mx-4" />
        </>
      )}

      {/* Template Variables */}
      {Object.keys(detail.variables).length > 0 && (
        <>
          <div className="px-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Template Variables
            </h3>
            <div className="space-y-1 text-sm">
              {Object.entries(detail.variables)
                .filter(([, val]) => val != null && val !== "" && !Array.isArray(val))
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <span className="text-right max-w-[60%] truncate">
                      {String(val)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
          <Separator className="mx-4" />
        </>
      )}

      {/* E-sign info */}
      {detail.eSignEnvelopeId && (
        <>
          <div className="px-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              E-Signature
            </h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider</span>
                <span>{detail.eSignProvider ?? "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Envelope ID</span>
                <span className="truncate max-w-[60%] text-right font-mono text-xs">
                  {detail.eSignEnvelopeId}
                </span>
              </div>
            </div>
          </div>
          <Separator className="mx-4" />
        </>
      )}

      {/* Dates */}
      <div className="px-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Timeline
        </h3>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <span>{formatRelativeTime(detail.createdAt)}</span>
          </div>
          {detail.approvedAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Approved</span>
              <span>{formatRelativeTime(detail.approvedAt)}</span>
            </div>
          )}
          {detail.sentAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sent</span>
              <span>{formatRelativeTime(detail.sentAt)}</span>
            </div>
          )}
          {detail.signedAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Signed</span>
              <span>{formatRelativeTime(detail.signedAt)}</span>
            </div>
          )}
        </div>
      </div>

      <Separator className="mx-4" />

      {/* Action Buttons */}
      <ActionButtons
        engagementId={detail.id}
        status={detail.status}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Status Timeline
// ---------------------------------------------------------------------------

function StatusTimeline({ status }: { status: string }) {
  const currentIdx = getStepIndex(status);
  const isTerminal = status === "declined" || status === "expired";

  if (isTerminal) {
    return (
      <Badge variant="destructive" className="text-xs capitalize">
        {STATUS_LABELS[status] ?? status}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {STATUS_STEPS.map((step, i) => {
        const isCompleted = i < currentIdx || (i === currentIdx && status === "signed");
        const isCurrent = i === currentIdx && status !== "signed";

        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={`h-2 w-2 rounded-full ${
                isCompleted
                  ? "bg-emerald-500"
                  : isCurrent
                    ? "bg-blue-500 animate-pulse"
                    : "bg-muted"
              }`}
              title={STATUS_LABELS[step]}
            />
            {i < STATUS_STEPS.length - 1 && (
              <div
                className={`h-px w-6 ${
                  isCompleted ? "bg-emerald-500" : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
      <span className="ml-2 text-xs text-muted-foreground capitalize">
        {STATUS_LABELS[status] ?? status}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Buttons
// ---------------------------------------------------------------------------

function ActionButtons({
  engagementId,
  status,
}: {
  engagementId: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmitForApproval() {
    setError(null);
    const formData = new FormData();
    formData.set("engagementLetterId", engagementId);
    startTransition(async () => {
      try {
        await submitForApproval(formData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  function handleSendForSignature() {
    setError(null);
    const formData = new FormData();
    formData.set("engagementLetterId", engagementId);
    startTransition(async () => {
      try {
        await sendForSignature(formData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <div className="px-4 pb-4">
      {error && (
        <p className="mb-2 text-sm text-destructive">{error}</p>
      )}

      {status === "draft" && (
        <Button
          className="w-full"
          disabled={isPending}
          onClick={handleSubmitForApproval}
        >
          {isPending ? "Submitting..." : "Submit for Approval"}
        </Button>
      )}

      {status === "pending_approval" && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-400">
          <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
          Awaiting attorney approval
        </div>
      )}

      {status === "approved" && (
        <Button
          className="w-full"
          disabled={isPending}
          onClick={handleSendForSignature}
        >
          {isPending ? "Sending..." : "Send for Signature"}
        </Button>
      )}

      {status === "sent" && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-400">
          <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          Awaiting client signature
        </div>
      )}

      {status === "signed" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Signed and complete
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="space-y-4 pt-4">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Separator className="my-4" />
      <Skeleton className="h-4 w-24" />
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-3 rounded-full" />
        ))}
      </div>
      <Separator className="my-4" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-16 w-full" />
      <Separator className="my-4" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-20 w-full" />
      <Separator className="my-4" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
