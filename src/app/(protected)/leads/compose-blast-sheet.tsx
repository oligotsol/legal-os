"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Mail, Sparkles, Send, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  fetchBlastTargets,
  previewBlastRecipients,
  sendBlast,
  draftBlastWithAi,
  type BlastChannel,
  type BlastFilters,
  type BlastTarget,
  type PreviewBlastResult,
  type SendBlastResult,
} from "./blast-actions";

const ANY_TARGET_KEY = "__any__";

const STATUS_OPTIONS = [
  { value: "any", label: "Any (new + contacted)" },
  { value: "new", label: "New only" },
  { value: "contacted", label: "Contacted only" },
];

const AGE_OPTIONS = [
  { value: 0, label: "Anyone" },
  { value: 3, label: "Not in last 3 days" },
  { value: 7, label: "Not in last 7 days" },
  { value: 14, label: "Not in last 14 days" },
  { value: 30, label: "Not in last 30 days" },
];

export function ComposeBlastSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<BlastChannel>("sms");

  // Filters
  const [targetKey, setTargetKey] = useState<string>(ANY_TARGET_KEY);
  const [targets, setTargets] = useState<BlastTarget[]>([]);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [status, setStatus] = useState<"any" | "new" | "contacted">("any");
  const [minDays, setMinDays] = useState<number>(0);

  // Composer
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // AI draft
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);

  // Preview
  const [preview, setPreview] = useState<PreviewBlastResult | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Send
  const [sendPending, startSend] = useTransition();
  const [sendResult, setSendResult] = useState<SendBlastResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const selectedTarget =
    targetKey === ANY_TARGET_KEY
      ? null
      : targets.find((t) => t.key === targetKey) ?? null;

  const filters: BlastFilters = {
    channel,
    source: selectedTarget?.source,
    listName: selectedTarget?.listName ?? undefined,
    status,
    minDaysSinceLastContact: minDays,
  };

  // Pull the firm's audience targets once when the sheet opens.
  useEffect(() => {
    if (!open || targetsLoaded) return;
    fetchBlastTargets()
      .then((rows) => {
        setTargets(rows);
        setTargetsLoaded(true);
      })
      .catch((e) =>
        setPreviewError(e instanceof Error ? e.message : "Failed to load audiences"),
      );
  }, [open, targetsLoaded]);

  // Auto-preview when filters change (debounced via the transition).
  useEffect(() => {
    if (!open) return;
    setPreviewError(null);
    startPreview(async () => {
      try {
        const r = await previewBlastRecipients(filters);
        setPreview(r);
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : "Preview failed");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, targetKey, status, minDays]);

  function handleAiDraft() {
    if (!aiBrief.trim()) {
      setAiError("Tell the AI what you want the message to do");
      return;
    }
    setAiError(null);
    startAi(async () => {
      try {
        const r = await draftBlastWithAi({ channel, brief: aiBrief });
        if (r.subject) setSubject(r.subject);
        setBody(r.body);
        setAiOpen(false);
        setAiBrief("");
      } catch (e) {
        setAiError(e instanceof Error ? e.message : "Draft failed");
      }
    });
  }

  function handleSend() {
    setSendError(null);
    setSendResult(null);
    if (!body.trim()) {
      setSendError("Body cannot be empty");
      return;
    }
    if (channel === "email" && !subject.trim()) {
      setSendError("Email subject is required");
      return;
    }
    if (!preview || preview.cappedAt === 0) {
      setSendError("No recipients match the current filters");
      return;
    }
    startSend(async () => {
      try {
        const r = await sendBlast({
          filters,
          body,
          subject: channel === "email" ? subject : undefined,
        });
        setSendResult(r);
        router.refresh();
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "Send failed");
      }
    });
  }

  function handleReset() {
    setSubject("");
    setBody("");
    setSendResult(null);
    setSendError(null);
  }

  const charCount = body.length;
  const smsMultiPart = channel === "sms" && charCount > 160;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Compose Blast
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 border-b px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Compose Blast
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Mass {channel === "sms" ? "text" : "email"} to a filtered list of
            leads. Replies land in Approvals as usual.
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {/* Channel toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setChannel("sms")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                channel === "sms"
                  ? "border-primary/40 bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted"
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Text
            </button>
            <button
              type="button"
              onClick={() => setChannel("email")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                channel === "email"
                  ? "border-primary/40 bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted"
              }`}
            >
              <Mail className="h-4 w-4" />
              Email
            </button>
          </div>

          {/* Filters */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Who receives this
            </h3>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                Target audience
              </label>
              <select
                value={targetKey}
                onChange={(e) => setTargetKey(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value={ANY_TARGET_KEY}>All sources (any list)</option>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label} ({t.count.toLocaleString()})
                  </option>
                ))}
              </select>
              {!targetsLoaded && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Loading audiences…
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "any" | "new" | "contacted")
                  }
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Last contact
                </label>
                <select
                  value={minDays}
                  onChange={(e) => setMinDays(Number(e.target.value))}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {AGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Always excluded: DNC contacts, converted leads, soft-deleted rows.
              Leads without a {channel === "sms" ? "phone number" : "email address"} are silently skipped.
            </p>
          </section>

          {/* Recipients preview */}
          <section className="rounded-md border bg-card">
            <div className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recipients
            </div>
            <div className="space-y-1.5 px-3 py-2 text-sm">
              {previewPending ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Counting…
                </p>
              ) : previewError ? (
                <p className="text-xs text-destructive">{previewError}</p>
              ) : preview ? (
                <>
                  <p>
                    <span className="text-2xl font-semibold tabular-nums">
                      {preview.cappedAt.toLocaleString()}
                    </span>{" "}
                    <span className="text-xs text-muted-foreground">
                      will receive
                      {preview.totalMatching > preview.cappedAt
                        ? ` (out of ${preview.totalMatching.toLocaleString()} matching — capped at ${preview.hardCap})`
                        : ""}
                    </span>
                  </p>
                  {preview.preview.length > 0 ? (
                    <ul className="space-y-1 border-t pt-1.5 text-xs">
                      {preview.preview.map((r) => (
                        <li
                          key={r.leadId}
                          className="flex items-center justify-between gap-2 text-muted-foreground"
                        >
                          <span className="truncate text-foreground">
                            {r.fullName}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {r.identifier}
                          </span>
                        </li>
                      ))}
                      {preview.cappedAt > preview.preview.length && (
                        <li className="text-[11px] italic text-muted-foreground">
                          + {(preview.cappedAt - preview.preview.length).toLocaleString()} more
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      No matching leads. Adjust filters.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </section>

          {/* Composer */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Message
              </h3>
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <Sparkles className="h-3 w-3" />
                {aiOpen ? "Hide AI draft" : "Draft with AI"}
              </button>
            </div>

            {aiOpen && (
              <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Tell the AI the intent of this blast. It will use Garrison&apos;s voice
                  doctrine and include {`{first_name}`} for personalization.
                </p>
                <Textarea
                  value={aiBrief}
                  onChange={(e) => setAiBrief(e.target.value)}
                  placeholder={`e.g. "estate planning value reminder, no urgency, end with a question"`}
                  rows={2}
                  disabled={aiPending}
                  className="min-h-[50px] resize-none text-xs"
                />
                {aiError && (
                  <p className="text-[11px] text-destructive">{aiError}</p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAiDraft}
                    disabled={aiPending || !aiBrief.trim()}
                    className="gap-1.5"
                  >
                    {aiPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Drafting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Draft
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {channel === "email" && (
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="text-sm"
              />
            )}

            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                channel === "sms"
                  ? `Hey {first_name}, ...`
                  : `Hi {first_name},\n\nWanted to follow up...`
              }
              rows={channel === "sms" ? 4 : 8}
              className="min-h-[120px] resize-none text-sm"
            />
            <p className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Tokens: {`{first_name}`}, {`{state}`}, {`{firm_name}`}
              </span>
              <span className="tabular-nums">
                {charCount} chars
                {smsMultiPart && (
                  <span className="ml-1 text-amber-600">
                    (multi-part SMS)
                  </span>
                )}
              </span>
            </p>
          </section>

          {/* Send result panel */}
          {sendResult && (
            <section
              className={`rounded-md border p-3 text-sm ${
                sendResult.failed > 0
                  ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                  : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
              }`}
            >
              <p className="font-semibold">
                Sent {sendResult.sent} of {sendResult.attempted}
                {sendResult.failed > 0 && ` · ${sendResult.failed} failed`}
              </p>
              {sendResult.capped && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Capped at 200 — re-run after these clear to reach the rest.
                </p>
              )}
              {sendResult.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Show first {sendResult.errors.length} error{sendResult.errors.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                    {sendResult.errors.map((e, i) => (
                      <li key={i}>
                        <span className="font-mono">{e.identifier}</span> — {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={handleReset}>
                  Compose another
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Close
                </Button>
              </div>
            </section>
          )}
        </div>

        {/* Footer — Send button */}
        {!sendResult && (
          <div className="shrink-0 space-y-2 border-t bg-background px-6 py-4">
            {sendError && (
              <p className="text-xs text-destructive">{sendError}</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[10px]">
                {channel.toUpperCase()} · {preview?.cappedAt ?? 0} recipients
              </Badge>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={sendPending}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={
                    sendPending ||
                    !body.trim() ||
                    !preview ||
                    preview.cappedAt === 0 ||
                    (channel === "email" && !subject.trim())
                  }
                  className="gap-1.5"
                >
                  {sendPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Send to {preview?.cappedAt ?? 0}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
