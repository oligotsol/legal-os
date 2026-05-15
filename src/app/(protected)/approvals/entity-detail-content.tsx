"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { formatDollars, formatRelativeTime } from "@/lib/format";
import type { ApprovalQueueItem } from "@/types/database";
import type { MessageContextThread } from "./actions";

interface EntityDetailContentProps {
  queueItem: ApprovalQueueItem;
  entity: Record<string, unknown> | null;
  messageContext?: MessageContextThread | null;
}

export function EntityDetailContent({
  queueItem,
  entity,
  messageContext,
}: EntityDetailContentProps) {
  if (!entity) {
    return (
      <p className="text-sm text-muted-foreground">
        Entity data not available.
      </p>
    );
  }

  switch (queueItem.entity_type) {
    case "message":
      return <MessageDetail entity={entity} messageContext={messageContext ?? null} />;
    case "fee_quote":
      return <FeeQuoteDetail entity={entity} />;
    case "engagement_letter":
      return <EngagementLetterDetail entity={entity} queueItem={queueItem} />;
    case "invoice":
      return <InvoiceDetail entity={entity} />;
    default:
      return (
        <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(entity, null, 2)}
        </pre>
      );
  }
}

function MessageDetail({
  entity,
  messageContext,
}: {
  entity: Record<string, unknown>;
  messageContext: MessageContextThread | null;
}) {
  const meta = entity.metadata as Record<string, unknown> | null;
  const reasoning = meta?.reasoning as string | undefined;
  const phase = meta?.phase_recommendation as string | undefined;
  const escalated = meta?.escalation_signal as boolean | undefined;
  const escalationReason = meta?.escalation_reason as string | undefined;
  const latestInbound = messageContext?.latestInbound ?? null;
  const recent = messageContext?.recent ?? [];
  const priorInboundCount = recent.filter((m) => m.direction === "inbound").length;
  const noPriorContext = priorInboundCount === 0;

  return (
    <div className="space-y-4">
      {/* Escalation callout — surfaces the flag prominently when the AI
          itself flagged the draft for review (most commonly because the
          thread has no prior context). */}
      {escalated && (
        <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              AI flagged this for review
            </p>
            <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              {escalationReason ??
                "The AI marked the draft as needing attorney attention. Review the prospect's message + prior thread below before sending."}
            </p>
          </div>
        </div>
      )}

      {/* What the prospect said — leads the panel because this is the
          single most useful thing for the reviewer. */}
      {latestInbound ? (
        <section className="rounded-md border bg-card">
          <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            What they said{" "}
            <span className="font-normal normal-case text-muted-foreground/80">
              · {formatRelativeTime(latestInbound.createdAt)}
              {latestInbound.channel ? ` · ${latestInbound.channel}` : ""}
            </span>
          </div>
          <p className="max-h-[220px] overflow-y-auto whitespace-pre-wrap px-3 py-2 text-sm leading-relaxed text-foreground">
            {latestInbound.content}
          </p>
        </section>
      ) : (
        <section className="rounded-md border border-dashed bg-muted/30 px-3 py-2">
          <p className="text-xs italic text-muted-foreground">
            No inbound message on record for this conversation. The AI drafted
            this without a prospect message to respond to; verify before sending.
          </p>
        </section>
      )}

      {/* Prior thread (other messages, both directions). Collapsed by
          default if there's anything more than what's already shown. */}
      {recent.length > 0 && (
        <details className="group rounded-md border bg-card">
          <summary className="cursor-pointer list-none border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground marker:hidden">
            Prior thread ({messageContext?.totalMessages ?? recent.length} total messages)
            <span className="float-right font-normal normal-case text-muted-foreground/70 group-open:hidden">
              expand
            </span>
            <span className="float-right hidden font-normal normal-case text-muted-foreground/70 group-open:inline">
              collapse
            </span>
          </summary>
          <ul className="max-h-[260px] divide-y overflow-y-auto">
            {recent.map((m) => (
              <li
                key={m.id}
                className={`px-3 py-2 ${
                  m.direction === "inbound"
                    ? "bg-emerald-50/30 dark:bg-emerald-950/15"
                    : "bg-muted/20"
                }`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${
                      m.direction === "inbound"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {m.direction === "inbound" ? "Prospect" : "We sent"}
                  </span>
                  {m.channel && (
                    <span className="rounded bg-background px-1.5 py-0.5 uppercase tracking-wider text-muted-foreground">
                      {m.channel}
                    </span>
                  )}
                  {m.status && m.status !== "sent" && m.status !== "delivered" && (
                    <span className="rounded bg-background px-1.5 py-0.5 uppercase tracking-wider text-muted-foreground">
                      {m.status}
                    </span>
                  )}
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {formatRelativeTime(m.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                  {m.content.length > 600
                    ? m.content.slice(0, 600) + "…"
                    : m.content}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Smaller secondary metadata + AI reasoning. The body of the draft
          itself is in the editable textarea in the action panel below. */}
      <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {entity.channel ? (
            <span className="text-muted-foreground">
              Channel:{" "}
              <span className="font-medium text-foreground">
                {String(entity.channel)}
              </span>
            </span>
          ) : null}
          {entity.sender_type ? (
            <span className="text-muted-foreground">
              Sender:{" "}
              <span className="font-medium text-foreground">
                {String(entity.sender_type)}
              </span>
            </span>
          ) : null}
          {phase ? (
            <span className="text-muted-foreground">
              Phase:{" "}
              <span className="font-medium text-foreground">{phase}</span>
            </span>
          ) : null}
        </div>
        {noPriorContext && (
          <p className="text-[11px] italic text-muted-foreground">
            Note: this conversation has no prior inbound messages on record. If
            the AI&apos;s draft references something the prospect supposedly
            said, the underlying signal may be stale or routed incorrectly.
          </p>
        )}
        {reasoning && (
          <details className="group">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground marker:hidden">
              AI reasoning
              <span className="ml-1 font-normal normal-case text-muted-foreground/70 group-open:hidden">
                (expand)
              </span>
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap text-[11px] italic leading-relaxed text-muted-foreground">
              {reasoning}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}

function FeeQuoteDetail({ entity }: { entity: Record<string, unknown> }) {
  const lineItems = entity.line_items as Record<string, unknown>[] | null;

  return (
    <div className="space-y-4">
      {lineItems && lineItems.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Line Items
          </h4>
          <div className="mt-2 overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Service</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      {(item.service_name as string) ?? "Service"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatDollars((item.subtotal as number) ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Separator />
      <div className="space-y-1">
        <DetailRow
          label="Subtotal"
          value={formatDollars((entity.subtotal as number) ?? 0)}
        />
        {(entity.bundle_discount as number) > 0 && (
          <DetailRow
            label="Bundle Discount"
            value={`-${formatDollars(entity.bundle_discount as number)}`}
          />
        )}
        {(entity.engagement_tier_discount as number) > 0 && (
          <DetailRow
            label="Engagement Discount"
            value={`-${formatDollars(entity.engagement_tier_discount as number)}`}
          />
        )}
        <div className="flex items-center justify-between pt-1 font-medium">
          <span className="text-sm">Total</span>
          <span className="text-sm tabular-nums">
            {formatDollars((entity.total_quoted_fee as number) ?? 0)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EngagementLetterDetail({
  entity,
  queueItem,
}: {
  entity: Record<string, unknown>;
  queueItem?: ApprovalQueueItem;
}) {
  const variables = entity.variables as Record<string, unknown> | null;
  const entityId = queueItem?.entity_id ?? (entity.id as string | undefined);

  return (
    <div className="space-y-4">
      {entity.template_key ? (
        <DetailRow label="Template" value={String(entity.template_key)} />
      ) : null}
      {variables && Object.keys(variables).length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Template Variables
          </h4>
          <div className="mt-2 space-y-1">
            {Object.entries(variables)
              .filter(([, val]) => val != null && val !== "" && !Array.isArray(val))
              .map(([key, val]) => (
                <DetailRow key={key} label={key} value={String(val)} />
              ))}
          </div>
        </div>
      )}
      <DetailRow label="Status" value={String(entity.status)} />
      {entityId && (
        <div className="pt-2">
          <Link
            href={`/engagements?id=${entityId}`}
            className="text-sm text-primary underline hover:no-underline"
          >
            View Engagement Letter
          </Link>
        </div>
      )}
    </div>
  );
}

function InvoiceDetail({ entity }: { entity: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-semibold tabular-nums">
          {formatDollars((entity.amount as number) ?? 0)}
        </span>
      </div>
      <Separator />
      <DetailRow label="Status" value={String(entity.status)} />
      {entity.payment_provider ? (
        <DetailRow
          label="Payment Provider"
          value={String(entity.payment_provider)}
        />
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
