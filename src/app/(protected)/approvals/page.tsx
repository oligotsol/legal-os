import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ApprovalFilters } from "./approval-filters";
import { ApprovalList } from "./approval-list";
import { ApprovalDetailSheet } from "./approval-detail-sheet";
import { fetchPendingApprovals, fetchApprovalCounts } from "./queries";
import type { ApprovalActionType } from "@/types/database";

interface ApprovalsPageProps {
  searchParams: Promise<{ filter?: string; item?: string }>;
}

export default async function ApprovalsPage({
  searchParams,
}: ApprovalsPageProps) {
  const params = await searchParams;
  const filter = params.filter as ApprovalActionType | undefined;

  const [items, counts] = await Promise.all([
    fetchPendingApprovals(filter),
    fetchApprovalCounts(),
  ]);

  return (
    <>
      <PageHeader title="Approvals" description="Review and approve pending items" />
      <div className="p-6">
        <div className="mb-6">
          <Suspense>
            <ApprovalFilters counts={counts} />
          </Suspense>
        </div>
        <ApprovalList items={items} />
      </div>
      <Suspense>
        <ApprovalDetailSheet />
      </Suspense>
    </>
  );
}
