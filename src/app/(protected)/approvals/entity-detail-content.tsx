"use client";

import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { formatDollars } from "@/lib/format";
import type { ApprovalQueueItem } from "@/types/database";

interface EntityDetailContentProps {
  queueItem: ApprovalQueueItem;
  entity: Record<string, unknown> | null;
}

export function EntityDetailContent({
  queueItem,
  entity,
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
      return <MessageDetail entity={entity} />;
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

function MessageDetail({ entity }: { entity: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Message Content
        </h4>
        <div className="mt-2 rounded-md bg-muted/50 p-3">
          <p className="whitespace-pre-wrap text-sm">{String(entity.content ?? "")}</p>
        </div>
      </div>
      {entity.channel ? (
        <DetailRow label="Channel" value={String(entity.channel)} />
      ) : null}
      {entity.sender_type ? (
        <DetailRow label="Sender" value={String(entity.sender_type)} />
      ) : null}
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
