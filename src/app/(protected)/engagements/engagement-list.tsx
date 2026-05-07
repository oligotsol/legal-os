"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, formatDollars } from "@/lib/format";
import type { EngagementListItem } from "./queries";

interface EngagementListProps {
  letters: EngagementListItem[];
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-400",
  pending_approval: "bg-yellow-500",
  approved: "bg-blue-500",
  sent: "bg-indigo-500",
  viewed: "bg-purple-500",
  signed: "bg-emerald-500",
  declined: "bg-red-500",
  expired: "bg-gray-500",
};

export function EngagementList({ letters }: EngagementListProps) {
  const router = useRouter();

  if (letters.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No engagement letters yet.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate one from a matter in the Pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-rise-in overflow-x-auto rounded-lg border bg-card shadow-sm shadow-foreground/5">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-gradient-to-b from-muted/60 to-muted/30">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matter Type</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">State</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fee</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Created</th>
          </tr>
        </thead>
        <tbody>
          {letters.map((letter) => (
            <tr
              key={letter.id}
              className="group cursor-pointer border-b last:border-0 transition-colors hover:bg-primary/[0.025]"
              onClick={() => router.push(`/engagements?id=${letter.id}`)}
            >
              <td className="px-4 py-3">
                <span className="font-medium">
                  {letter.contactName}
                </span>
                {letter.contactEmail && (
                  <p className="text-xs text-muted-foreground">{letter.contactEmail}</p>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground capitalize">
                {letter.matterType?.replace(/_/g, " ") ?? "\u2014"}
              </td>
              <td className="px-4 py-3">
                {letter.stateCode ?? "\u2014"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${STATUS_COLORS[letter.status] ?? "bg-gray-400"}`}
                  />
                  <span className="text-xs capitalize">
                    {letter.status.replace(/_/g, " ")}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {letter.totalFee != null ? formatDollars(letter.totalFee) : "\u2014"}
              </td>
              <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                {formatRelativeTime(letter.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
