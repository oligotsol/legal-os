import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import {
  fetchPipelineFunnel,
  fetchSlaQueue,
  fetchActiveMatters,
  fetchAiSpend,
  fetchRecentAuditEntries,
  fetchApprovalSummary,
} from "./queries";
import { PipelineFunnel } from "./pipeline-funnel";
import { SlaQueue } from "./sla-queue";
import { ApprovalSummary } from "./approval-summary";
import { ActiveMattersTable } from "./active-matters-table";
import { AiSpendCard } from "./ai-spend-card";
import { AuditTrail } from "./audit-trail";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [funnel, slaQueue, activeMatters, aiSpend, auditEntries, approvals] =
    await Promise.all([
      fetchPipelineFunnel(supabase),
      fetchSlaQueue(supabase),
      fetchActiveMatters(supabase),
      fetchAiSpend(supabase),
      fetchRecentAuditEntries(supabase),
      fetchApprovalSummary(supabase),
    ]);

  return (
    <>
      <PageHeader title="Command Center" />
      <div className="grid gap-4 p-6 lg:grid-cols-2 xl:grid-cols-3">
        <div className="lg:col-span-2 xl:col-span-2">
          <PipelineFunnel items={funnel} />
        </div>
        <ApprovalSummary items={approvals} />
        <SlaQueue items={slaQueue} />
        <AiSpendCard
          items={aiSpend.items}
          totalCostCents={aiSpend.totalCostCents}
        />
        <AuditTrail entries={auditEntries} />
        <div className="lg:col-span-2 xl:col-span-3">
          <ActiveMattersTable matters={activeMatters} />
        </div>
      </div>
    </>
  );
}
