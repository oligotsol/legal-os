"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { formatRelativeTime, formatDollars } from "@/lib/format";
import type { SlaColor } from "@/lib/pipeline/transitions";

const SLA_DOT_CLASSES: Record<SlaColor, string> = {
  CRITICAL: "bg-red-600 animate-pulse",
  RED: "bg-red-500 animate-pulse",
  ORANGE: "bg-orange-500",
  YELLOW: "bg-yellow-500",
  GREEN: "bg-emerald-500",
  NONE: "bg-gray-300",
};

interface MatterCardProps {
  id: string;
  contactName: string;
  stageName: string;
  fee: number | null;
  slaColor: SlaColor;
  updatedAt: string;
}

export function MatterCard({
  id,
  contactName,
  stageName,
  fee,
  slaColor,
  updatedAt,
}: MatterCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSelected = searchParams.get("matter") === id;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("matter", id);
    router.push(`/pipeline?${params.toString()}`);
  }

  return (
    <button
      onClick={handleClick}
      className={`
        group w-full rounded-lg border bg-card p-4 text-left transition-all duration-150
        ring-1 ring-foreground/10 hover:ring-foreground/20 hover:shadow-sm
        ${isSelected ? "ring-primary/40 shadow-sm" : ""}
      `}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${SLA_DOT_CLASSES[slaColor]}`}
          title={`SLA: ${slaColor}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-card-foreground truncate">
            {contactName}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{stageName}</span>
            <span>&middot;</span>
            <span className="tabular-nums">{fee != null ? formatDollars(fee) : "\u2014"}</span>
            <span>&middot;</span>
            <span className="shrink-0">{formatRelativeTime(updatedAt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}
