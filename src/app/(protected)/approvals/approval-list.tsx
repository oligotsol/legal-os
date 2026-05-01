import { ShieldCheck } from "lucide-react";
import { ApprovalCard } from "./approval-card";
import type { EnrichedQueueItem } from "./queries";

interface ApprovalListProps {
  items: EnrichedQueueItem[];
}

export function ApprovalList({ items }: ApprovalListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/5">
          <ShieldCheck className="h-6 w-6 text-primary/40" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">
          All clear
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No items pending approval.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ApprovalCard key={item.id} item={item} />
      ))}
    </div>
  );
}
