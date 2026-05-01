import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { EngagementList } from "./engagement-list";
import { EngagementDetailSheet } from "./engagement-detail-sheet";
import { fetchEngagementLetters } from "./queries";

interface EngagementsPageProps {
  searchParams: Promise<{ status?: string; id?: string }>;
}

export default async function EngagementsPage({
  searchParams,
}: EngagementsPageProps) {
  const params = await searchParams;
  const statusFilter = params.status ?? undefined;
  const selectedId = params.id;

  const supabase = await createClient();
  const letters = await fetchEngagementLetters(
    supabase,
    statusFilter ? { status: statusFilter } : undefined,
  );

  return (
    <>
      <PageHeader
        title="Engagements"
        description={`${letters.length} engagement letter${letters.length !== 1 ? "s" : ""}`}
      />
      <div className="p-6">
        <EngagementList letters={letters} />
      </div>
      <Suspense>
        <EngagementDetailSheet />
      </Suspense>
    </>
  );
}
