"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

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
    <div className="animate-rise-in overflow-hidden rounded-lg border bg-card shadow-sm shadow-foreground/5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gradient-to-b from-muted/60 to-muted/30">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Classification</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Created</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const href = lead.conversationId
              ? `/conversations?id=${lead.conversationId}`
              : `/leads`;

            return (
              <tr
                key={lead.id}
                onClick={() => router.push(href)}
                className="group cursor-pointer border-b last:border-0 transition-colors hover:bg-primary/[0.025]"
              >
                <td className="relative px-4 py-3">
                  {/* Hover accent stripe on the leftmost cell */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5 bg-primary opacity-0 transition-opacity group-hover:opacity-100"
                  />
                  {/* Keep the Link for keyboard / accessibility navigation;
                      stop propagation so it doesn't double-trigger the row's
                      onClick. */}
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium decoration-primary/30 underline-offset-4 hover:underline"
                  >
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
