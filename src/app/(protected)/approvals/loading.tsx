import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ApprovalsLoading() {
  return (
    <>
      <PageHeader title="Approvals" description="Review and approve pending items" />
      <div className="p-6">
        <Skeleton className="mb-6 h-9 w-96" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </>
  );
}
