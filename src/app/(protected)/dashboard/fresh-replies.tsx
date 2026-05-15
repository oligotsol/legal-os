import Link from "next/link";
import { MessageCircle, Mail, Flame, ChevronRight } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import type { FreshReply } from "./queries";

export function FreshRepliesCard({ replies }: { replies: FreshReply[] }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          Fresh replies
          {replies.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {replies.length}
            </span>
          )}
        </h2>
        <Link
          href="/approvals"
          className="text-[11px] font-medium text-primary hover:underline"
        >
          Open approvals →
        </Link>
      </div>

      {replies.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          No replies waiting on you. When a prospect texts or emails back, their
          message + the AI draft will land here for one-click review.
        </div>
      ) : (
        <ul className="divide-y">
          {replies.map((r) => (
            <li key={r.approvalQueueId}>
              <Link
                href={`/approvals?item=${r.approvalQueueId}`}
                className="flex gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1">
                  {r.channel === "email" ? (
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  {r.highIntent && (
                    <Flame className="h-3.5 w-3.5 text-red-500" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.leadScoreTier && r.leadScoreTier !== "unknown" && (
                      <TierChip tier={r.leadScoreTier} />
                    )}
                    <span className="truncate text-sm font-medium text-foreground">
                      {r.contactName}
                    </span>
                    {r.highIntent && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        Hot reply
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {r.inboundAt
                        ? formatRelativeTime(r.inboundAt)
                        : formatRelativeTime(r.approvalCreatedAt)}
                    </span>
                  </div>

                  {r.inboundPreview && (
                    <div className="rounded border-l-2 border-emerald-400 bg-emerald-50/40 px-2 py-1 text-xs leading-snug text-foreground/90 dark:bg-emerald-950/15">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        They said
                      </span>
                      <p className="whitespace-pre-wrap">{r.inboundPreview}</p>
                    </div>
                  )}

                  <div className="rounded border-l-2 border-primary/40 bg-primary/[0.04] px-2 py-1 text-xs leading-snug text-muted-foreground">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-primary/80">
                      AI draft
                    </span>
                    <p className="whitespace-pre-wrap text-foreground/80">
                      {r.draftPreview}
                    </p>
                  </div>

                  {r.highIntentMatches.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Signal: {r.highIntentMatches.join(" · ")}
                    </p>
                  )}
                </div>

                <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
              </Link>
            </li>
          ))}
          <li className="border-t bg-muted/20">
            <Link
              href="/approvals"
              className="flex items-center justify-center gap-1 px-4 py-2 text-[11px] font-medium text-primary hover:bg-muted/40"
            >
              See all replies
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}

function TierChip({
  tier,
}: {
  tier: "hot" | "warm" | "cool" | "cold" | "unknown";
}) {
  const styles: Record<typeof tier, string> = {
    hot: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
    warm: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    cool: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    cold: "bg-muted text-muted-foreground",
    unknown: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${styles[tier]}`}
    >
      {tier}
    </span>
  );
}
