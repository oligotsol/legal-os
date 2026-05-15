"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Phone,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageBubble } from "../../conversations/message-bubble";
import { ApprovalActions } from "../../approvals/approval-actions";
import { convertLead, sendMessage } from "../../conversations/actions";
import { addLeadNote } from "./actions";
import { formatRelativeTime } from "@/lib/format";
import { useRegisterLexContext } from "@/components/lex/lex-context-provider";
import type { ConversationThread } from "../../conversations/queries";

export interface LeadDetailData {
  leadId: string;
  leadStatus: string;
  leadSource: string;
  leadChannel: string | null;
  leadCreatedAt: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  state: string | null;
  dnc: boolean;
  contactId: string | null;
  clientDescription: string | null;
  matterType: string | null;
  classificationConfidence: number | null;
  caseId: string | null;
  city: string | null;
  notes: Array<{
    body: string;
    addedAt: string;
    addedBy: string | null;
    source: string | null;
  }>;
  thread: ConversationThread | null;
  initialCompose: "sms" | "email" | null;
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "default",
  contacted: "secondary",
  qualified: "default",
  unqualified: "outline",
  converted: "secondary",
  dead: "destructive",
  dnc: "destructive",
};

const PHASE_LABELS: Record<string, string> = {
  initial_contact: "Initial Contact",
  qualification: "Qualification",
  scheduling: "Scheduling",
  follow_up: "Follow Up",
  negotiation: "Negotiation",
  closing: "Closing",
};

export function LeadDetail({ data }: { data: LeadDetailData }) {
  useRegisterLexContext("lead", data.leadId);
  const phaseLabel = data.thread
    ? PHASE_LABELS[data.thread.phase] ?? data.thread.phase
    : null;

  return (
    <div className="flex flex-col">
      {/* Header — compact, bold, with the action that matters right inline */}
      <div className="glass-header sticky top-0 z-30 border-b border-border/60 px-4 py-3 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Link
                href="/leads"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Back to leads"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                {data.fullName}
              </h1>
              <Badge
                variant={STATUS_VARIANTS[data.leadStatus] ?? "outline"}
                className="text-xs capitalize"
              >
                {data.leadStatus.replace(/_/g, " ")}
              </Badge>
              {data.dnc && (
                <Badge variant="destructive" className="text-[10px]">
                  DNC
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-xs text-muted-foreground">
              <span>
                Source:{" "}
                <span className="font-semibold capitalize text-foreground">
                  {data.leadSource}
                </span>
              </span>
              {phaseLabel && (
                <span>
                  Phase:{" "}
                  <span className="font-semibold text-foreground">
                    {phaseLabel}
                  </span>
                </span>
              )}
              {data.matterType && (
                <span>
                  Matter:{" "}
                  <span className="font-semibold text-foreground">
                    {data.matterType}
                  </span>
                  {data.classificationConfidence !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({data.classificationConfidence}%)
                    </span>
                  )}
                </span>
              )}
              <span className="tabular-nums">
                Created {formatRelativeTime(data.leadCreatedAt)}
              </span>
            </div>
          </div>

          {data.thread && data.contactId && data.leadStatus !== "converted" && (
            <ConvertToMatterButton
              leadId={data.leadId}
              contactId={data.contactId}
              classification={data.thread.classification}
              contactState={data.state}
            />
          )}
        </div>
      </div>

      {/* Body — 2-column: Info left, work area right */}
      <div className="grid flex-1 gap-5 p-4 md:grid-cols-[240px_minmax(0,1fr)] md:p-5 md:pb-10">
        {/* Left: Info column */}
        <aside className="space-y-3">
          <Section title="Contact">
            <InfoRow label="Email">
              {data.email ? (
                <span className="break-all">{data.email}</span>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="Phone">{data.phone ?? "—"}</InfoRow>
            <InfoRow label="State">{data.state ?? "—"}</InfoRow>
            <InfoRow label="City">{data.city ?? "—"}</InfoRow>
            {data.caseId && (
              <InfoRow label="Case #">{data.caseId}</InfoRow>
            )}
          </Section>

          {data.clientDescription && (
            <Section title="Client description">
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {data.clientDescription}
              </p>
            </Section>
          )}

          <NotesSection leadId={data.leadId} notes={data.notes} />

          {data.thread?.context && hasEthicsSignals(data.thread.context) && (
            <Section title="Ethics signals" tone="warning">
              <EthicsSignals signals={data.thread.context.ethics_signals} />
            </Section>
          )}
        </aside>

        {/* Right: Interactions (activity feed + composer) */}
        <InteractionsPane data={data} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactions pane — activity feed + composer
// ---------------------------------------------------------------------------

function InteractionsPane({ data }: { data: LeadDetailData }) {
  const thread = data.thread;

  if (!thread) {
    return (
      <div className="rounded-xl border-2 border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
        No conversation yet. When this lead replies the thread will appear here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Activity feed */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Activity
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto p-4">
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
      </div>

      {/* Composer / pending approval — visually distinct, raised */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.025] p-4 shadow-md ring-1 ring-primary/10">
        <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <ArrowRight className="h-3.5 w-3.5" />
          {thread.pendingApproval ? "AI draft — review & send" : "Reply"}
        </div>

        {thread.pendingApproval ? (
          <ApprovalActions
            queueItemId={thread.pendingApproval.queueItemId}
            initialContent={thread.pendingApproval.content}
            entityType="message"
          />
        ) : data.phone || data.email ? (
          <ComposeBox
            conversationId={thread.id}
            hasPhone={!!data.phone}
            hasEmail={!!data.email}
            initialChannel={data.initialCompose}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No phone or email on file. Add one to compose a reply.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComposeBox
// ---------------------------------------------------------------------------

function ComposeBox({
  conversationId,
  hasPhone,
  hasEmail,
  initialChannel,
}: {
  conversationId: string;
  hasPhone: boolean;
  hasEmail: boolean;
  initialChannel: "sms" | "email" | null;
}) {
  const router = useRouter();
  const bothChannels = hasPhone && hasEmail;
  const defaultChannel: "sms" | "email" =
    initialChannel &&
    ((initialChannel === "sms" && hasPhone) ||
      (initialChannel === "email" && hasEmail))
      ? initialChannel
      : hasPhone
        ? "sms"
        : "email";

  const [channel, setChannel] = useState<"sms" | "email">(defaultChannel);
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSend() {
    if (!content.trim()) {
      setError("Message cannot be empty");
      return;
    }
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("conversationId", conversationId);
    formData.set("content", content);
    formData.set("channel", channel);
    if (channel === "email" && subject) {
      formData.set("subject", subject);
    }

    startTransition(async () => {
      try {
        const result = await sendMessage(formData);
        if (result.status === "sent") {
          setContent("");
          setSubject("");
          const time = result.sentAt
            ? new Date(result.sentAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })
            : "now";
          const providerLabel = result.provider
            ? ` via ${result.provider}`
            : "";
          setSuccess(
            result.dryRun
              ? `Dry-run dispatched at ${time} (no real send — integration inactive).`
              : `Sent ${channel === "email" ? "email" : "text"} at ${time}${providerLabel}.`,
          );
          router.refresh();
        } else {
          setError(
            result.error
              ? `Send failed: ${result.error.slice(0, 240)}`
              : "Send failed — check integration credentials.",
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send");
      }
    });
  }

  return (
    <div className="space-y-3">
      {bothChannels && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setChannel("sms")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              channel === "sms"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            SMS
          </button>
          <button
            type="button"
            onClick={() => setChannel("email")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              channel === "email"
                ? "bg-primary text-primary-foreground shadow-sm"
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

      <Textarea
        placeholder="Type a message…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={isPending}
        rows={4}
        className="min-h-[110px] resize-none rounded-md border-2 border-primary/20 bg-background text-[15px] leading-relaxed shadow-inner focus:border-primary/40 focus-visible:ring-primary/30"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSend();
          }
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Sending via {channel.toUpperCase()} · dispatched immediately when you
          click Send
        </p>
        <Button
          onClick={handleSend}
          disabled={isPending || !content.trim()}
          className="gap-1.5"
        >
          <Send className="h-4 w-4" />
          {isPending ? "Sending…" : "Send"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
          ✓ {success}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convert to Matter — moved into the header
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
      <Button
        size="sm"
        variant="default"
        onClick={() => setOpen(true)}
        className="shrink-0 gap-1.5"
      >
        Convert to matter
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert Lead to Matter</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleConvert} className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
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
              <Input name="summary" placeholder="Brief matter summary..." />
            </div>
            <div className="flex justify-end gap-3">
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

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "warning";
}) {
  const toneClasses =
    tone === "warning"
      ? "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30"
      : "bg-card";
  return (
    <section className={`rounded-lg border ${toneClasses}`}>
      <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1.5 p-3">{children}</div>
    </section>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}

function hasEthicsSignals(context: Record<string, unknown> | null): boolean {
  if (!context) return false;
  const signals = context.ethics_signals;
  if (Array.isArray(signals) && signals.length > 0) return true;
  if (
    typeof signals === "object" &&
    signals !== null &&
    Object.keys(signals).length > 0
  )
    return true;
  return false;
}

function NotesSection({
  leadId,
  notes,
}: {
  leadId: string;
  notes: LeadDetailData["notes"];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        await addLeadNote(leadId, trimmed, "lead_detail");
        setDraft("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add note");
      }
    });
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Internal notes ({notes.length})
      </div>
      <div className="space-y-2 p-3">
        <Textarea
          placeholder="Add a note (e.g. wants callback Tue, mentioned 2018 trust)..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          rows={3}
          className="min-h-[70px] resize-none text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">⌘⏎ to add</p>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={isPending || !draft.trim()}
            className="h-7 px-2 text-xs"
          >
            {isPending ? "Adding..." : "Add note"}
          </Button>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        {notes.length > 0 && (
          <ul className="max-h-[280px] space-y-2 overflow-y-auto border-t pt-2">
            {notes.map((n, i) => (
              <li
                key={`${n.addedAt}-${i}`}
                className="rounded-md border bg-muted/30 px-2.5 py-1.5"
              >
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
                  <span>{formatRelativeTime(n.addedAt)}</span>
                  {n.source && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                      {n.source === "power_dialer" ? "dialer" : "lead"}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                  {n.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EthicsSignals({ signals }: { signals: unknown }) {
  if (Array.isArray(signals)) {
    return (
      <ul className="list-disc space-y-1 pl-4 text-xs text-orange-700 dark:text-orange-400">
        {signals.map((s, i) => (
          <li key={i}>{String(s)}</li>
        ))}
      </ul>
    );
  }
  if (typeof signals === "object" && signals !== null) {
    return (
      <ul className="list-disc space-y-1 pl-4 text-xs text-orange-700 dark:text-orange-400">
        {Object.entries(signals).map(([k, v]) => (
          <li key={k}>
            <span className="font-medium">{k}:</span> {String(v)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-orange-700 dark:text-orange-400">
      <AlertTriangle className="h-3.5 w-3.5" />
      Signals present
    </p>
  );
}
