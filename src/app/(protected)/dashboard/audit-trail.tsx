import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import type { AuditEntry } from "./queries";

const ACTION_LABELS: Record<string, string> = {
  "pipeline.stage_transition": "Stage transition",
  "pipeline.auto_referred.amicus_lex": "Referred to Amicus Lex",
  "pipeline.auto_referred.thaler": "Referred to Thaler",
  "ethics.scan": "Ethics scan",
  "drip.final_followup": "Final drip follow-up",
};

export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-2 border-b pb-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.entityType}
                    {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
