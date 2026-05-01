import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ACTION_TYPE_LABELS,
  ACTION_TYPE_BADGE_CLASSES,
} from "@/lib/approval-labels";
import type { ApprovalActionType } from "@/types/database";
import type { ApprovalSummary as ApprovalSummaryType } from "./queries";

export function ApprovalSummary({ items }: { items: ApprovalSummaryType[] }) {
  const total = items.reduce((sum, i) => sum + i.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Pending Approvals
          {total > 0 && (
            <Badge variant="destructive" className="ml-2">
              {total}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending approvals.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const label =
                ACTION_TYPE_LABELS[item.actionType as ApprovalActionType] ??
                item.actionType;
              const badgeClass =
                ACTION_TYPE_BADGE_CLASSES[
                  item.actionType as ApprovalActionType
                ] ?? "";

              return (
                <Link
                  key={item.actionType}
                  href="/approvals"
                  className="flex items-center justify-between rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                    {label}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {item.count}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
