import { ShieldCheck } from "lucide-react";
import { ApprovalCard } from "./approval-card";
import type { EnrichedQueueItem } from "./queries";

interface ApprovalListProps {
  items: EnrichedQueueItem[];
}

export function ApprovalList({ items }: ApprovalListProps) {
  if (items.length === 0) {
    return (
      <div className="animate-rise-in flex flex-col items-center justify-center py-20 text-center">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/5">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-primary/10 animate-soft-pulse"
          />
          <ShieldCheck className="relative h-7 w-7 text-primary/50" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">All clear</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No items pending approval.
        </p>
      </div>
    );
  }

  return (
    <div className="stagger-children flex flex-col gap-3">
      {items.map((item) => (
        <ApprovalCard key={item.id} item={item} />
      ))}
    </div>
  );
}
