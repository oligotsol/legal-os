import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function FeeCalculatorLoading() {
  return (
    <>
      <PageHeader
        title="Fee Calculator"
        description="Build a quote for a matter"
      />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6 lg:flex-row">
        {/* Left column skeleton: service selection */}
        <div className="flex-1 space-y-6">
          {/* Category group */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-5 w-40" />
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full rounded-md" />
              ))}
            </div>
          ))}
          {/* Bundle selector */}
          <Skeleton className="h-10 w-full rounded-md" />
          {/* Floor toggle */}
          <Skeleton className="h-6 w-48" />
        </div>

        {/* Right column skeleton: quote summary */}
        <div className="w-full space-y-4 lg:w-96">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </>
  );
}
