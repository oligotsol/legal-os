import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationsLoading() {
  return (
    <>
      <PageHeader
        title="Conversations"
        description="View and manage lead conversations"
      />
      <div className="p-6">
        <Skeleton className="mb-6 h-9 w-96" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </>
  );
}
