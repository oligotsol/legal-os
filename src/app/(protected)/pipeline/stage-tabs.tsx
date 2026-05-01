"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { PipelineStageWithCounts } from "./queries";

const STAGE_TYPE_DOT_COLORS: Record<string, string> = {
  intake: "bg-blue-500",
  qualification: "bg-indigo-500",
  negotiation: "bg-amber-500",
  closing: "bg-emerald-500",
  post_close: "bg-teal-500",
};

interface StageTabsProps {
  stages: PipelineStageWithCounts[];
}

export function StageTabs({ stages }: StageTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStage = searchParams.get("stage");

  const totalCount = stages.reduce((sum, s) => sum + s.matterCount, 0);

  function handleClick(slug: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug === null) {
      params.delete("stage");
    } else {
      params.set("stage", slug);
    }
    // Clear matter selection when switching stages
    params.delete("matter");
    router.push(`/pipeline?${params.toString()}`);
  }

  return (
    <nav className="flex flex-col gap-0.5">
      {/* All tab */}
      <button
        onClick={() => handleClick(null)}
        className={`
          flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors
          ${!activeStage ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}
        `}
      >
        <span>All</span>
        {totalCount > 0 && (
          <Badge
            variant="secondary"
            className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
          >
            {totalCount}
          </Badge>
        )}
      </button>

      {/* Stage tabs */}
      {stages.map((stage) => (
        <button
          key={stage.id}
          onClick={() => handleClick(stage.slug)}
          className={`
            flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors
            ${activeStage === stage.slug ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}
          `}
        >
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${STAGE_TYPE_DOT_COLORS[stage.stageType] ?? "bg-gray-400"}`}
            />
            <span className="truncate">{stage.name}</span>
          </span>
          {stage.matterCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-2 h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
            >
              {stage.matterCount}
            </Badge>
          )}
        </button>
      ))}
    </nav>
  );
}
