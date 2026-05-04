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
import {
  ACTION_TYPE_LABELS,
  ACTION_TYPE_BADGE_CLASSES,
} from "@/lib/approval-labels";
import { formatRelativeTime } from "@/lib/format";
import { fetchItemDetail } from "./actions";
import { EntityDetailContent } from "./entity-detail-content";
import { ApprovalActions } from "./approval-actions";
import type { ApprovalQueueItem } from "@/types/database";

export function ApprovalDetailSheet() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const itemId = searchParams.get("item");

  const [queueItem, setQueueItem] = useState<ApprovalQueueItem | null>(null);
  const [entity, setEntity] = useState<Record<string, unknown> | null>(null);
  const [isLoading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) {
      setQueueItem(null);
      setEntity(null);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await fetchItemDetail(itemId);
        setQueueItem(result.queueItem);
        setEntity(result.entity);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load item");
      }
    });
  }, [itemId]);

  function handleClose() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("item");
    router.push(`/approvals?${params.toString()}`);
  }

  // Derive editable content for messages
  const editableContent =
    queueItem?.entity_type === "message" && entity
      ? (entity.content as string) ?? undefined
      : undefined;

  return (
    <Sheet open={!!itemId} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {isLoading && (
          <div className="overflow-y-auto p-6">
            <DetailSkeleton />
          </div>
        )}

        {error && (
          <div className="overflow-y-auto p-6 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && queueItem && (
          <>
            {/* Header — fixed at the top of the sheet */}
            <SheetHeader className="shrink-0 border-b px-6 py-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-xs font-medium ${ACTION_TYPE_BADGE_CLASSES[queueItem.action_type]}`}
                >
                  {ACTION_TYPE_LABELS[queueItem.action_type]}
                </Badge>
              </div>
              <SheetTitle className="text-base font-medium">
                {(queueItem.metadata as Record<string, unknown>)?.summary as string ??
                  `${ACTION_TYPE_LABELS[queueItem.action_type]} Review`}
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                Created {formatRelativeTime(queueItem.created_at)}
              </p>
            </SheetHeader>

            {/* Body — scrolls; min-h-0 is critical so flex-1 actually shrinks */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <EntityDetailContent queueItem={queueItem} entity={entity} />
            </div>

            {/* Action buttons — sticky at the bottom of the sheet */}
            {queueItem.status === "pending" && (
              <div className="shrink-0 border-t bg-background px-6 py-4">
                <ApprovalActions
                  queueItemId={queueItem.id}
                  initialContent={editableContent}
                  entityType={queueItem.entity_type}
                />
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 pt-4">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-32" />
      <Separator className="my-4" />
      <Skeleton className="h-32 w-full" />
      <Separator className="my-4" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}
