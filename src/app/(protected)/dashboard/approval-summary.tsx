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
    <Card className="relative overflow-hidden border-border/60 bg-card/80 backdrop-blur-sm transition-shadow hover:shadow-md hover:shadow-foreground/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Pending Approvals</span>
          {total > 0 && (
            <Badge variant="destructive" className="animate-soft-pulse">
              {total}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending approvals.</p>
        ) : (
          <div className="stagger-children space-y-2">
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
                  href={`/approvals?filter=${item.actionType}`}
                  className="
                    group flex items-center justify-between rounded-md border px-3 py-2
                    transition-all duration-200
                    hover:-translate-y-px hover:border-foreground/20 hover:bg-muted/40 hover:shadow-sm
                  "
                >
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                    {label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums transition-transform group-hover:scale-110">
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
