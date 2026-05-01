import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDollars } from "@/lib/format";
import type { PipelineFunnelItem } from "./queries";

const STAGE_TYPE_COLORS: Record<string, string> = {
  intake: "bg-blue-500",
  qualification: "bg-indigo-500",
  negotiation: "bg-amber-500",
  closing: "bg-emerald-500",
  post_close: "bg-teal-500",
};

export function PipelineFunnel({ items }: { items: PipelineFunnelItem[] }) {
  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active pipeline stages.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.stageId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                  {item.name}
                </span>
                <div className="flex-1">
                  <div
                    className={`h-5 rounded ${STAGE_TYPE_COLORS[item.stageType] ?? "bg-gray-400"} transition-all`}
                    style={{ width: `${Math.max((item.count / maxCount) * 100, 4)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs font-medium tabular-nums">
                  {item.count}
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                  {item.totalFeeValue > 0 ? formatDollars(item.totalFeeValue) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
