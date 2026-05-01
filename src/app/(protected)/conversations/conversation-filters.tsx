"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUSES = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "escalated", label: "Escalated" },
  { value: "closed", label: "Closed" },
];

export function ConversationFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStatus = searchParams.get("status") ?? "";

  function handleStatusChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    params.delete("id"); // Clear detail selection on filter change
    router.push(`/conversations?${params.toString()}`);
  }

  return (
    <Tabs value={activeStatus} onValueChange={handleStatusChange}>
      <TabsList className="h-9">
        {STATUSES.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} className="gap-1.5 text-xs">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
