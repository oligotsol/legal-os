"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import type { LeadListItem } from "./queries";

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface LeadListProps {
  leads: LeadListItem[];
}

const DESCRIPTION_TRUNCATE = 60;

/**
 * Renders an attorney name compactly for the leads-list column:
 * "William \"Garrison\" English, Esq." -> "Garrison English"
 * "Bridget Catherine Sciamanna, Esq."  -> "Bridget Sciamanna"
 */
function shortAttorneyName(name: string): string {
  const stripped = name.replace(/,?\s*Esq\.?$/, "").trim();
  // Pull a quoted nickname if present, plus a surname guess.
  const nicknameMatch = stripped.match(/"([^"]+)"/);
  const tokens = stripped.replace(/"[^"]*"/, "").trim().split(/\s+/);
  const surname = tokens[tokens.length - 1] ?? "";
  if (nicknameMatch) return `${nicknameMatch[1]} ${surname}`.trim();
  const first = tokens[0] ?? "";
  return `${first} ${surname}`.trim();
}

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
    <TooltipProvider delay={200}>
      <div className="animate-rise-in overflow-x-auto rounded-lg border bg-card shadow-sm shadow-foreground/5">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b bg-gradient-to-b from-muted/60 to-muted/30">
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Attorney</Th>
              <Th>Last Contact</Th>
              <Th>Lead Phone</Th>
              <Th>Lead Source</Th>
              <Th>Lead Created At</Th>
              <Th>Lead Email</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const detailHref = `/leads/${lead.id}`;
              const phoneHref = lead.phone
                ? `/leads/${lead.id}?compose=sms`
                : null;
              const emailHref = lead.email
                ? `/leads/${lead.id}?compose=email`
                : null;
              const desc = lead.description ?? "";
              const descFull = lead.descriptionFull ?? lead.description ?? "";
              const truncated =
                desc.length > DESCRIPTION_TRUNCATE
                  ? desc.slice(0, DESCRIPTION_TRUNCATE).trimEnd() + "…"
                  : desc;

              return (
                <tr
                  key={lead.id}
                  onClick={() => router.push(detailHref)}
                  className="group cursor-pointer border-b last:border-0 transition-colors hover:bg-primary/[0.025]"
                >
                  <td className="relative px-4 py-3">
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-0.5 bg-primary opacity-0 transition-opacity group-hover:opacity-100"
                    />
                    <Link
                      href={detailHref}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium decoration-primary/30 underline-offset-4 hover:underline"
                    >
                      {lead.fullName}
                    </Link>
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-muted-foreground">
                    {desc ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="block cursor-help truncate">
                              {truncated}
                            </span>
                          }
                        />
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-md whitespace-pre-wrap break-words text-left"
                        >
                          {descFull}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {lead.assignedAttorneyName ? (
                      <div className="flex flex-col leading-tight">
                        <span className="text-xs text-foreground">
                          {shortAttorneyName(lead.assignedAttorneyName)}
                        </span>
                        {lead.state && (
                          <span className="text-[10px] text-muted-foreground">
                            {lead.state}
                          </span>
                        )}
                      </div>
                    ) : lead.state ? (
                      <span className="text-[10px] text-muted-foreground">
                        {lead.state}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {lead.lastContactAt ? (
                      <div className="flex flex-col leading-tight">
                        <span className="text-foreground">
                          {formatShortDate(lead.lastContactAt)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(lead.lastContactAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {phoneHref ? (
                      <Link
                        href={phoneHref}
                        onClick={(e) => e.stopPropagation()}
                        className="decoration-primary/30 underline-offset-4 hover:text-primary hover:underline"
                      >
                        {lead.phone}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-0.5">
                      <Badge variant="outline" className="text-xs capitalize">
                        {lead.source}
                      </Badge>
                      {lead.listName && (
                        <span
                          className="max-w-[160px] truncate text-[10px] text-muted-foreground"
                          title={lead.listName}
                        >
                          {lead.listName}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    <div className="flex flex-col leading-tight">
                      <span className="text-foreground">
                        {formatShortDate(lead.createdAt)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(lead.createdAt)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {emailHref ? (
                      <Link
                        href={emailHref}
                        onClick={(e) => e.stopPropagation()}
                        className="decoration-primary/30 underline-offset-4 hover:text-primary hover:underline"
                      >
                        {lead.email}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
      {children}
    </th>
  );
}
