"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, formatDollars } from "@/lib/format";
import { fetchMatterDetailAction, transitionMatter } from "./actions";
import { generateLetter } from "../engagements/actions";
import type { MatterDetail } from "./queries";
import type { SlaColor } from "@/lib/pipeline/transitions";
import Link from "next/link";

const SLA_COLOR_CLASSES: Record<SlaColor, string> = {
  CRITICAL: "bg-red-600 animate-pulse",
  RED: "bg-red-500 animate-pulse",
  ORANGE: "bg-orange-500",
  YELLOW: "bg-yellow-500",
  GREEN: "bg-emerald-500",
  NONE: "bg-gray-300",
};

const SLA_COLOR_LABELS: Record<SlaColor, string> = {
  CRITICAL: "Critical - SLA breached",
  RED: "Overdue",
  ORANGE: "At risk",
  YELLOW: "Monitor",
  GREEN: "On track",
  NONE: "No SLA",
};

export function MatterDetailSheet() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const matterId = searchParams.get("matter");

  const [detail, setDetail] = useState<MatterDetail | null>(null);
  const [isLoading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matterId) {
      setDetail(null);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await fetchMatterDetailAction(matterId);
        setDetail(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load matter");
      }
    });
  }, [matterId]);

  function handleClose() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("matter");
    router.push(`/pipeline?${params.toString()}`);
  }

  return (
    <Sheet open={!!matterId} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {isLoading && <DetailSkeleton />}

        {error && (
          <div className="py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && detail && (
          <MatterDetailContent detail={detail} />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Detail Content
// ---------------------------------------------------------------------------

function MatterDetailContent({ detail }: { detail: MatterDetail }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-base font-medium">
          {detail.contact?.fullName ?? "Unknown Contact"}
        </SheetTitle>
        {detail.summary && (
          <p className="text-sm text-muted-foreground">{detail.summary}</p>
        )}
      </SheetHeader>

      {/* Contact info */}
      {detail.contact && (
        <div className="px-4">
          <div className="space-y-1 text-sm">
            {detail.contact.email && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-12 shrink-0">Email</span>
                <span className="truncate">{detail.contact.email}</span>
              </div>
            )}
            {detail.contact.phone && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-12 shrink-0">Phone</span>
                <span>{detail.contact.phone}</span>
              </div>
            )}
            {detail.contact.state && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-12 shrink-0">State</span>
                <span>{detail.contact.state}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <Separator className="mx-4" />

      {/* Current stage + SLA */}
      <div className="px-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Current Stage
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${SLA_COLOR_CLASSES[detail.slaColor]}`}
          />
          <span className="text-sm font-medium">
            {detail.stage?.name ?? "Unassigned"}
          </span>
          <span className="text-xs text-muted-foreground">
            ({SLA_COLOR_LABELS[detail.slaColor]})
          </span>
        </div>
      </div>

      {/* Classification */}
      {detail.classification && (
        <div className="px-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Classification
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary" className="text-xs">
              {detail.classification.matterType}
            </Badge>
            <span className="text-muted-foreground">
              {Math.round(detail.classification.confidence * 100)}% confidence
            </span>
          </div>
        </div>
      )}

      {/* Fee quote */}
      {detail.feeQuote && (
        <div className="px-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Fee Quote
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium tabular-nums">
              {formatDollars(detail.feeQuote.totalQuotedFee)}
            </span>
            <Badge variant="outline" className="text-xs capitalize">
              {detail.feeQuote.status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
      )}

      {/* Create Fee Quote */}
      {!detail.feeQuote && (
        <div className="px-4">
          <Link
            href={`/pipeline/fee-calculator?matter_id=${detail.id}`}
            className="inline-flex h-8 w-full items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background hover:bg-accent hover:text-accent-foreground"
          >
            Create Fee Quote
          </Link>
        </div>
      )}

      {/* Generate Engagement Letter */}
      {detail.feeQuote &&
        ["approved", "accepted", "sent"].includes(detail.feeQuote.status) &&
        detail.jurisdiction && (
          <div className="px-4">
            <GenerateEngagementButton
              matterId={detail.id}
              feeQuoteId={detail.feeQuote.id}
            />
          </div>
        )}

      <Separator className="mx-4" />

      {/* Stage transitions */}
      <TransitionButtons
        matterId={detail.id}
        allowedTransitions={detail.allowedTransitions}
      />

      <Separator className="mx-4" />

      {/* Stage history */}
      {detail.stageHistory.length > 0 && (
        <div className="px-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Stage History
          </h3>
          <div className="space-y-3">
            {detail.stageHistory.map((entry) => (
              <div key={entry.id} className="flex gap-3 text-sm">
                <div className="flex flex-col items-center">
                  <div className="h-2 w-2 rounded-full bg-border mt-1.5" />
                  <div className="flex-1 w-px bg-border" />
                </div>
                <div className="pb-3">
                  <p className="text-sm">
                    {entry.fromStageName ? (
                      <>
                        <span className="text-muted-foreground">{entry.fromStageName}</span>
                        {" \u2192 "}
                        <span className="font-medium">{entry.toStageName}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Entered</span>{" "}
                        <span className="font-medium">{entry.toStageName}</span>
                      </>
                    )}
                  </p>
                  {entry.reason && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {entry.reason}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatRelativeTime(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversations */}
      {detail.conversations.length > 0 && (
        <>
          <Separator className="mx-4" />
          <div className="px-4 pb-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Conversations
            </h3>
            <div className="space-y-2">
              {detail.conversations.map((convo) => (
                <Link
                  key={convo.id}
                  href={`/conversations?id=${convo.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">
                      {convo.phase.replace(/_/g, " ")}
                    </Badge>
                    <Badge
                      variant={convo.status === "active" ? "default" : "secondary"}
                      className="text-xs capitalize"
                    >
                      {convo.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {convo.messageCount} msgs
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Transition Buttons
// ---------------------------------------------------------------------------

function TransitionButtons({
  matterId,
  allowedTransitions,
}: {
  matterId: string;
  allowedTransitions: MatterDetail["allowedTransitions"];
}) {
  const [isPending, startTransition] = useTransition();

  if (allowedTransitions.length === 0) {
    return (
      <div className="px-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Transition
        </h3>
        <p className="text-sm text-muted-foreground">No transitions available from this stage.</p>
      </div>
    );
  }

  function handleTransition(toStageId: string) {
    const formData = new FormData();
    formData.set("matterId", matterId);
    formData.set("toStageId", toStageId);
    startTransition(async () => {
      try {
        await transitionMatter(formData);
      } catch (e) {
        console.error("Transition failed:", e);
      }
    });
  }

  return (
    <div className="px-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Transition
      </h3>
      <div className="flex flex-wrap gap-2">
        {allowedTransitions.map((stage) => (
          <Button
            key={stage.id}
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleTransition(stage.id)}
          >
            {stage.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate Engagement Letter
// ---------------------------------------------------------------------------

function GenerateEngagementButton({
  matterId,
  feeQuoteId,
}: {
  matterId: string;
  feeQuoteId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    const formData = new FormData();
    formData.set("matterId", matterId);
    formData.set("feeQuoteId", feeQuoteId);
    startTransition(async () => {
      try {
        const letterId = await generateLetter(formData);
        router.push(`/engagements?id=${letterId}`);
      } catch (e) {
        console.error("Failed to generate engagement letter:", e);
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      disabled={isPending}
      onClick={handleGenerate}
    >
      {isPending ? "Generating..." : "Generate Engagement Letter"}
    </Button>
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
      <Skeleton className="h-5 w-40" />
      <Separator className="my-4" />
      <Skeleton className="h-4 w-24" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Separator className="my-4" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
