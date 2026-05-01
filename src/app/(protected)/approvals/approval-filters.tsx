"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { ApprovalActionType } from "@/types/database";
import { ACTION_TYPE_LABELS } from "@/lib/approval-labels";

interface ApprovalFiltersProps {
  counts: Record<string, number>;
}

const FILTER_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  ...Object.entries(ACTION_TYPE_LABELS)
    .filter(([key]) => key !== "other")
    .map(([key, label]) => ({ value: key, label })),
];

export function ApprovalFilters({ counts }: ApprovalFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") ?? "all";

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  function handleFilterChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    params.delete("item"); // Clear detail selection on filter change
    router.push(`/approvals?${params.toString()}`);
  }

  return (
    <Tabs value={activeFilter} onValueChange={handleFilterChange}>
      <TabsList className="h-9">
        {FILTER_TABS.map(({ value, label }) => {
          const count =
            value === "all"
              ? totalCount
              : counts[value as ApprovalActionType] ?? 0;
          return (
            <TabsTrigger
              key={value}
              value={value}
              className="gap-1.5 text-xs"
            >
              {label}
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
                >
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
