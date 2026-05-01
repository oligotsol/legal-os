import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { ConversationFilters } from "./conversation-filters";
import { ConversationList } from "./conversation-list";
import { ConversationDetailSheet } from "./conversation-detail-sheet";
import { fetchConversations, fetchConversationThread } from "./queries";
import type { ConversationStatus } from "@/types/database";

interface ConversationsPageProps {
  searchParams: Promise<{ status?: string; id?: string }>;
}

export default async function ConversationsPage({
  searchParams,
}: ConversationsPageProps) {
  const params = await searchParams;
  const statusFilter = params.status as ConversationStatus | undefined;
  const selectedId = params.id;

  const supabase = await createClient();

  const [conversations, thread] = await Promise.all([
    fetchConversations(supabase, statusFilter ? { status: statusFilter } : undefined),
    selectedId ? fetchConversationThread(supabase, selectedId) : null,
  ]);

  return (
    <>
      <PageHeader
        title="Conversations"
        description="View and manage lead conversations"
      />
      <div className="p-6">
        <div className="mb-6">
          <Suspense>
            <ConversationFilters />
          </Suspense>
        </div>
        <ConversationList conversations={conversations} />
      </div>
      {selectedId && thread && (
        <ConversationDetailSheet thread={thread} />
      )}
    </>
  );
}
