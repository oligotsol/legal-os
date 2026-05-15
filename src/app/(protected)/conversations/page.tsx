import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { ConversationFilters } from "./conversation-filters";
import { ConversationList } from "./conversation-list";
import { fetchConversations } from "./queries";
import type { ConversationStatus } from "@/types/database";

interface ConversationsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ConversationsPage({
  searchParams,
}: ConversationsPageProps) {
  const params = await searchParams;
  const statusFilter = params.status as ConversationStatus | undefined;

  const supabase = await createClient();

  const conversations = await fetchConversations(
    supabase,
    statusFilter ? { status: statusFilter } : undefined,
  );

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Click a conversation to open the lead it belongs to."
      />
      <div className="p-6">
        <div className="mb-6">
          <Suspense>
            <ConversationFilters />
          </Suspense>
        </div>
        <ConversationList conversations={conversations} />
      </div>
    </>
  );
}
