import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDollars, formatRelativeTime } from "@/lib/format";
import type { ActiveMatter } from "./queries";

export function ActiveMattersTable({ matters }: { matters: ActiveMatter[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Matters</CardTitle>
      </CardHeader>
      <CardContent>
        {matters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active matters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Contact</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Stage</th>
                  <th className="pb-2 pr-4 text-right font-medium">Fee</th>
                  <th className="pb-2 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {matters.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{m.contactName}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {m.matterType?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="py-2 pr-4">{m.stageName}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {m.totalFee != null ? formatDollars(m.totalFee) : "—"}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {formatRelativeTime(m.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
