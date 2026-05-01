"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import type { LeadListItem } from "./queries";

interface LeadListProps {
  leads: LeadListItem[];
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  contacted: "secondary",
  qualified: "default",
  unqualified: "outline",
  converted: "secondary",
  dead: "destructive",
  dnc: "destructive",
};

export function LeadList({ leads }: LeadListProps) {
  if (leads.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">No leads found.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href="/leads/create" className="text-primary underline">
            Create your first lead
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Contact</th>
            <th className="px-4 py-3 text-left font-medium">Source</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Classification</th>
            <th className="px-4 py-3 text-right font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const href = lead.conversationId
              ? `/conversations?id=${lead.conversationId}`
              : `/leads`;

            return (
              <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link href={href} className="font-medium hover:underline">
                    {lead.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {lead.email ?? lead.phone ?? "\u2014"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs capitalize">
                    {lead.source}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant={STATUS_VARIANTS[lead.status] ?? "outline"}
                    className="text-xs capitalize"
                  >
                    {lead.status.replace(/_/g, " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {lead.classificationMatterType ? (
                    <span className="text-xs">
                      <span className="font-medium">
                        {lead.classificationMatterType}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        ({lead.classificationConfidence}%)
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Pending</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                  {formatRelativeTime(lead.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
