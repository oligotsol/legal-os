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
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {isLoading && <DetailSkeleton />}

        {error && (
          <div className="py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && queueItem && (
          <>
            <SheetHeader>
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

            <Separator className="my-4" />

            <EntityDetailContent queueItem={queueItem} entity={entity} />

            <Separator className="my-4" />

            {queueItem.status === "pending" && (
              <ApprovalActions
                queueItemId={queueItem.id}
                initialContent={editableContent}
              />
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
