import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StageTabs } from "./stage-tabs";
import { MatterList } from "./matter-list";
import { MatterDetailSheet } from "./matter-detail-sheet";
import { fetchStagesWithCounts, fetchMattersForStage } from "./queries";

interface PipelinePageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams;
  const stageSlug = params.stage ?? null;
  const selectedMatterId = params.matter;

  const supabase = await createClient();

  const [stages, matters] = await Promise.all([
    fetchStagesWithCounts(supabase),
    fetchMattersForStage(supabase, stageSlug),
  ]);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`${matters.length} matter${matters.length !== 1 ? "s" : ""}${stageSlug ? ` in ${stages.find((s) => s.slug === stageSlug)?.name ?? stageSlug}` : ""}`}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: stage tabs */}
        <div className="w-56 shrink-0 border-r border-border">
          <ScrollArea className="h-full">
            <div className="p-3">
              <Suspense>
                <StageTabs stages={stages} />
              </Suspense>
            </div>
          </ScrollArea>
        </div>

        {/* Right side: matter list */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4">
              <MatterList matters={matters} />
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Detail sheet (conditionally rendered based on URL param) */}
      {selectedMatterId && (
        <Suspense>
          <MatterDetailSheet />
        </Suspense>
      )}
    </>
  );
}
