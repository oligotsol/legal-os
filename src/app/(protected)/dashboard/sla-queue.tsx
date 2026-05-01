import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SlaQueueItem } from "./queries";
import type { SlaColor } from "@/lib/pipeline/transitions";

const SLA_DOT_CLASSES: Record<SlaColor, string> = {
  CRITICAL: "bg-red-600 animate-pulse",
  RED: "bg-red-600 animate-pulse",
  ORANGE: "bg-orange-500",
  YELLOW: "bg-yellow-500",
  GREEN: "bg-emerald-500",
  NONE: "bg-gray-300",
};

const SLA_LABELS: Record<SlaColor, string> = {
  CRITICAL: "Critical",
  RED: "Overdue",
  ORANGE: "Urgent",
  YELLOW: "Warning",
  GREEN: "On Track",
  NONE: "No SLA",
};

export function SlaQueue({ items }: { items: SlaQueueItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA Queue</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matters with active SLAs.</p>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 10).map((item) => (
              <div
                key={item.matterId}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${SLA_DOT_CLASSES[item.slaColor]}`}
                  title={SLA_LABELS[item.slaColor]}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.contactName}</p>
                  <p className="text-xs text-muted-foreground">{item.stageName}</p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.hoursRemaining != null
                    ? item.hoursRemaining > 0
                      ? `${item.hoursRemaining}h left`
                      : `${Math.abs(item.hoursRemaining)}h over`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
