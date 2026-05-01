"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Send } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "./message-bubble";
import { convertLead, sendMessage } from "./actions";
import type { ConversationThread } from "./queries";

interface ConversationDetailSheetProps {
  thread: ConversationThread;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500",
  paused: "bg-yellow-500",
  escalated: "bg-red-500",
  closed: "bg-gray-400",
};

const PHASE_LABELS: Record<string, string> = {
  initial_contact: "Initial Contact",
  qualification: "Qualification",
  scheduling: "Scheduling",
  follow_up: "Follow Up",
  negotiation: "Negotiation",
  closing: "Closing",
};

export function ConversationDetailSheet({
  thread,
}: ConversationDetailSheetProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  function handleClose() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("id");
    router.push(`/conversations?${params.toString()}`);
  }

  const statusColor = STATUS_COLORS[thread.status] ?? "bg-gray-400";
  const phaseLabel = PHASE_LABELS[thread.phase] ?? thread.phase;

  const ethicsSignals = thread.context?.ethics_signals;
  const hasEthics =
    (Array.isArray(ethicsSignals) && ethicsSignals.length > 0) ||
    (typeof ethicsSignals === "object" &&
      ethicsSignals !== null &&
      Object.keys(ethicsSignals).length > 0);

  return (
    <Sheet open onOpenChange={(open) => !open && handleClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${statusColor}`}
              title={thread.status}
            />
            <SheetTitle className="text-base font-medium">
              {thread.contactName}
            </SheetTitle>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {thread.channel && (
              <Badge variant="secondary" className="text-[10px]">
                {thread.channel.toUpperCase()}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-normal">
              {phaseLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-normal capitalize">
              {thread.status}
            </Badge>
            {thread.contactState && (
              <span className="text-xs text-muted-foreground">
                {thread.contactState}
              </span>
            )}
          </div>
          {thread.contactEmail && (
            <p className="text-xs text-muted-foreground">
              {thread.contactEmail}
            </p>
          )}
          {thread.contactPhone && (
            <p className="text-xs text-muted-foreground">
              {thread.contactPhone}
            </p>
          )}
        </SheetHeader>

        {thread.classification && (
          <>
            <Separator />
            <div className="px-4">
              <p className="text-xs text-muted-foreground">
                Classified as:{" "}
                <span className="font-medium text-foreground">
                  {thread.classification.matterType}
                </span>{" "}
                ({thread.classification.confidence}% confidence)
              </p>
            </div>
          </>
        )}

        {hasEthics && (
          <>
            <Separator />
            <div className="mx-4 flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-950/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
              <div className="text-xs text-orange-700 dark:text-orange-400">
                <p className="font-medium">Ethics signals detected</p>
                {Array.isArray(ethicsSignals) && (
                  <ul className="mt-1 list-disc pl-4">
                    {ethicsSignals.map((signal, i) => (
                      <li key={i}>{String(signal)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}

        <Separator />

        <ScrollArea className="flex-1 px-4">
          <div className="flex flex-col gap-3 pb-4">
            {thread.messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No messages yet.
              </p>
            ) : (
              thread.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}
          </div>
        </ScrollArea>

        {(thread.contactPhone || thread.contactEmail) && (
          <>
            <Separator />
            <ComposeBox
              conversationId={thread.id}
              hasPhone={!!thread.contactPhone}
              hasEmail={!!thread.contactEmail}
            />
          </>
        )}

        {thread.leadId && thread.leadStatus !== "converted" && thread.contactId && (
          <>
            <Separator />
            <div className="px-4 pb-4">
              <ConvertToMatterButton
                leadId={thread.leadId}
                contactId={thread.contactId}
                classification={thread.classification}
                contactState={thread.contactState}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Compose Box
// ---------------------------------------------------------------------------

function ComposeBox({
  conversationId,
  hasPhone,
  hasEmail,
}: {
  conversationId: string;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  const bothChannels = hasPhone && hasEmail;
  const defaultChannel = hasPhone ? "sms" : "email";

  const [channel, setChannel] = useState<"sms" | "email">(defaultChannel);
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSend() {
    if (!content.trim()) {
      setError("Message cannot be empty");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("conversationId", conversationId);
    formData.set("content", content);
    formData.set("channel", channel);
    if (channel === "email" && subject) {
      formData.set("subject", subject);
    }

    startTransition(async () => {
      try {
        await sendMessage(formData);
        setContent("");
        setSubject("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send");
      }
    });
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      {bothChannels && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setChannel("sms")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              channel === "sms"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            SMS
          </button>
          <button
            type="button"
            onClick={() => setChannel("email")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              channel === "email"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Email
          </button>
        </div>
      )}

      {channel === "email" && (
        <Input
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isPending}
          className="text-sm"
        />
      )}

      <div className="flex gap-2">
        <Textarea
          placeholder="Type a message..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={isPending}
          rows={2}
          className="min-h-[60px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={isPending || !content.trim()}
          className="shrink-0 self-end"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {!bothChannels && (
        <p className="text-[10px] text-muted-foreground">
          Sending via {channel.toUpperCase()}
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <p className="text-[10px] text-muted-foreground">
        Message will be queued for approval before sending.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convert to Matter
// ---------------------------------------------------------------------------

function ConvertToMatterButton({
  leadId,
  contactId,
  classification,
  contactState,
}: {
  leadId: string;
  contactId: string;
  classification: ConversationThread["classification"];
  contactState: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConvert(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("leadId", leadId);
    formData.set("contactId", contactId);

    startTransition(async () => {
      try {
        const matterId = await convertLead(formData);
        setOpen(false);
        router.push(`/pipeline?matter=${matterId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Conversion failed");
      }
    });
  }

  return (
    <>
      <Button size="sm" className="w-full" onClick={() => setOpen(true)}>
        Convert to Matter
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert Lead to Matter</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleConvert} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Matter Type
              </label>
              <Input
                name="matterType"
                defaultValue={classification?.matterType ?? ""}
                placeholder="e.g. estate_planning"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Jurisdiction (State)
              </label>
              <Input
                name="jurisdiction"
                defaultValue={contactState ?? ""}
                placeholder="e.g. TX"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Summary
              </label>
              <Input
                name="summary"
                placeholder="Brief matter summary..."
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Converting..." : "Convert"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
