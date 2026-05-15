import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import {
  fetchPipelineFunnel,
  fetchSlaQueue,
  fetchActiveMatters,
  fetchAiSpend,
  fetchRecentAuditEntries,
  fetchApprovalSummary,
  fetchDialerFunnel,
  fetchFreshReplies,
} from "./queries";
import { PipelineFunnel } from "./pipeline-funnel";
import { SlaQueue } from "./sla-queue";
import { ApprovalSummary } from "./approval-summary";
import { ActiveMattersTable } from "./active-matters-table";
import { AiSpendCard } from "./ai-spend-card";
import { AuditTrail } from "./audit-trail";
import { DialerFunnelCard } from "./dialer-funnel";
import { FreshRepliesCard } from "./fresh-replies";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    funnel,
    dialerFunnel,
    freshReplies,
    slaQueue,
    activeMatters,
    aiSpend,
    auditEntries,
    approvals,
  ] = await Promise.all([
    fetchPipelineFunnel(supabase),
    fetchDialerFunnel(supabase),
    fetchFreshReplies(supabase, 4),
    fetchSlaQueue(supabase),
    fetchActiveMatters(supabase),
    fetchAiSpend(supabase),
    fetchRecentAuditEntries(supabase),
    fetchApprovalSummary(supabase),
  ]);

  return (
    <>
      <PageHeader title="Command Center" />
      <div className="relative">
        <div
          aria-hidden
          className="mesh-aurora pointer-events-none absolute inset-0 -z-10"
        />
        <div className="stagger-children space-y-4 p-6">
          {/* Top row: Fresh replies (wide) + right column with AI spend on
              top and SLA queue under. Pending approvals sits compact below
              fresh replies, not stretched. */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <FreshRepliesCard replies={freshReplies} />
              <ApprovalSummary items={approvals} />
            </div>
            <div className="space-y-4">
              <AiSpendCard
                items={aiSpend.items}
                totalCostCents={aiSpend.totalCostCents}
              />
              <SlaQueue items={slaQueue} />
            </div>
          </div>

          {/* Horizontal row across the page: dialer funnel, pipeline funnel,
              recent activity. Three equal columns on lg+. */}
          <div className="grid gap-4 lg:grid-cols-3">
            <DialerFunnelCard funnel={dialerFunnel} />
            <PipelineFunnel items={funnel} />
            <AuditTrail entries={auditEntries} />
          </div>

          {/* Bottom: matters table full width. */}
          <ActiveMattersTable matters={activeMatters} />
        </div>
      </div>
    </>
  );
}
