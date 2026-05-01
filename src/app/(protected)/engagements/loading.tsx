import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function EngagementsLoading() {
  return (
    <>
      <PageHeader title="Engagements" description="Loading..." />
      <div className="p-6 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </>
  );
}
