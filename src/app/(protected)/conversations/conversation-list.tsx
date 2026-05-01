import { MessageSquare } from "lucide-react";
import { ConversationCard } from "./conversation-card";
import type { ConversationListItem } from "./queries";

interface ConversationListProps {
  conversations: ConversationListItem[];
}

export function ConversationList({ conversations }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/5">
          <MessageSquare className="h-6 w-6 text-primary/40" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">
          No conversations found
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversations will appear here as leads come in.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {conversations.map((conversation) => (
        <ConversationCard key={conversation.id} conversation={conversation} />
      ))}
    </div>
  );
}
