"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mic,
  MessageCircle,
  PauseCircle,
  PhoneCall,
  PhoneIncoming,
  SkipForward,
  StickyNote,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatRelativeTime } from "@/lib/format";
import { useRegisterLexContext } from "@/components/lex/lex-context-provider";
import {
  connectAndOptionallyConvert,
  holdLead,
  markVoicemailLeft,
  pollDialerLeadState,
  removeLead,
  sendSchedulingLink,
  skipLead,
  startDialerCall,
  triggerNoAnswerCadence,
} from "./actions";
import { addLeadNote } from "../leads/[id]/actions";
import { CsvImportDialog } from "../leads/csv-import-dialog";
import {
  fillScriptTemplate,
  type DialerFirmConfig,
  type DialerQueueItem,
  type DialerSourceBreakdown,
} from "./queries";

// ---------------------------------------------------------------------------
// Phase machine
//
// The Dialpad call-end webhook drives the cadence server-side. The client
// just shows the right phase based on what it polls back. Garrison's only
// outcome decisions are "Connected (got on the call)" or "Not a fit
// (remove)" — everything else is automatic.
// ---------------------------------------------------------------------------

type Phase =
  | { kind: "idle" }
  | { kind: "calling_1" } // server-side initiated, waiting for hangup webhook
  | { kind: "cadence_running" } // webhook fired no-answer; SMS + 2nd call in flight
  | { kind: "calling_2" } // 2nd call active, waiting for hangup webhook
  | { kind: "voicemail" } // webhook said 2nd no-answer; show VM script
  | { kind: "queue_done" };

type Flash =
  | { kind: "ok"; text: string }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | null;

interface DialerSnapshot {
  attempts: number;
  status: string | null;
  lastOutcome: string | null;
  needsVoicemail: boolean;
  historyLen: number;
}

interface State {
  queue: DialerQueueItem[];
  activeIndex: number;
  phase: Phase;
  flash: Flash;
  lastCallId: string | null;
  /** Track the historyLen we last saw — when it bumps, we know the webhook
   *  applied a cadence step and we can transition phases. */
  lastHistoryLen: number;
}

type Action =
  | { type: "CALL_STARTED"; callId: string | null }
  | { type: "CALL_FAILED"; message: string }
  | { type: "POLL_TICK"; snap: DialerSnapshot }
  | { type: "ADVANCE_TO_NEXT_LEAD" }
  | { type: "REPLACE_QUEUE"; queue: DialerQueueItem[]; activeIndex: number }
  | { type: "FLASH"; flash: Flash }
  | { type: "RESET_TO_IDLE" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CALL_STARTED":
      return {
        ...state,
        phase: { kind: "calling_1" },
        lastCallId: action.callId,
        flash: { kind: "info", text: "Ringing your Dialpad — answer to connect." },
        lastHistoryLen: state.lastHistoryLen,
      };
    case "CALL_FAILED":
      return {
        ...state,
        phase: { kind: "idle" },
        flash: { kind: "error", text: action.message },
      };
    case "POLL_TICK": {
      const { snap } = action;
      // Derive next phase from server-driven state. Order matters.
      if (snap.needsVoicemail) {
        if (state.phase.kind !== "voicemail") {
          return {
            ...state,
            phase: { kind: "voicemail" },
            flash: { kind: "info", text: "No answer on 2nd call. Voicemail script ready." },
            lastHistoryLen: snap.historyLen,
          };
        }
        return state;
      }
      // attempts === 1 means webhook fired the no-answer step → SMS + 2nd call
      // are running or have just kicked off.
      if (snap.attempts >= 1 && state.phase.kind === "calling_1") {
        return {
          ...state,
          phase: { kind: "cadence_running" },
          flash: { kind: "info", text: "No answer. Sending text and calling back…" },
          lastHistoryLen: snap.historyLen,
        };
      }
      // Once we see the second call_id has updated (history len bumped again
      // beyond the SMS step), move into calling_2.
      if (
        state.phase.kind === "cadence_running" &&
        snap.historyLen > state.lastHistoryLen
      ) {
        return {
          ...state,
          phase: { kind: "calling_2" },
          flash: { kind: "info", text: "Second call ringing." },
          lastHistoryLen: snap.historyLen,
        };
      }
      // No transition — just snapshot the historyLen.
      return { ...state, lastHistoryLen: snap.historyLen };
    }
    case "ADVANCE_TO_NEXT_LEAD": {
      const next = state.activeIndex + 1;
      if (next >= state.queue.length) {
        return { ...state, phase: { kind: "queue_done" }, flash: null };
      }
      return {
        ...state,
        activeIndex: next,
        phase: { kind: "idle" },
        flash: null,
        lastCallId: null,
        lastHistoryLen: 0,
      };
    }
    case "REPLACE_QUEUE": {
      const idx = Math.max(0, Math.min(action.activeIndex, action.queue.length));
      const phase: Phase =
        idx >= action.queue.length ? { kind: "queue_done" } : { kind: "idle" };
      return {
        ...state,
        queue: action.queue,
        activeIndex: idx,
        phase,
        flash: null,
        lastCallId: null,
        lastHistoryLen: 0,
      };
    }
    case "FLASH":
      return { ...state, flash: action.flash };
    case "RESET_TO_IDLE":
      return {
        ...state,
        phase: { kind: "idle" },
        flash: null,
        lastHistoryLen: 0,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DialerQueue({
  queue,
  config,
  sources,
  activeFilterKey,
}: {
  queue: DialerQueueItem[];
  config: DialerFirmConfig;
  sources: DialerSourceBreakdown[];
  activeFilterKey: string;
}) {
  const [state, dispatch] = useReducer(reducer, {
    queue,
    activeIndex: 0,
    phase: queue.length === 0 ? { kind: "queue_done" } : { kind: "idle" },
    flash: null,
    lastCallId: null,
    lastHistoryLen: 0,
  });

  const [connectedDialogOpen, setConnectedDialogOpen] = useState(false);

  const active = state.queue[state.activeIndex] ?? null;
  useRegisterLexContext("power_dialer", active?.id ?? null);

  // Auto-clear flash after 2.5s.
  useEffect(() => {
    if (!state.flash) return;
    const t = setTimeout(() => dispatch({ type: "FLASH", flash: null }), 2500);
    return () => clearTimeout(t);
  }, [state.flash]);

  // Polling — drives webhook-driven phase transitions.
  const phaseIsActive =
    state.phase.kind === "calling_1" ||
    state.phase.kind === "cadence_running" ||
    state.phase.kind === "calling_2";

  useEffect(() => {
    if (!phaseIsActive || !active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await pollDialerLeadState(active.id);
        if (cancelled) return;
        dispatch({ type: "POLL_TICK", snap });
      } catch {
        /* silent — keep polling */
      }
    };
    void tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phaseIsActive, active]);

  // Auto-call next lead after any advance.
  const pendingAutoCallRef = useRef(false);
  useEffect(() => {
    if (
      state.phase.kind === "idle" &&
      pendingAutoCallRef.current &&
      active &&
      active.phone
    ) {
      pendingAutoCallRef.current = false;
      void handleCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase.kind, state.activeIndex]);

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------

  const handleCall = useCallback(async () => {
    if (!active) return;
    dispatch({ type: "FLASH", flash: { kind: "info", text: "Calling…" } });
    try {
      const r = await startDialerCall(active.id);
      dispatch({ type: "CALL_STARTED", callId: r.callId });
    } catch (e) {
      dispatch({
        type: "CALL_FAILED",
        message: e instanceof Error ? e.message : "Call failed",
      });
    }
  }, [active]);

  // "Connected" opens an inline dialog with matter capture fields + a note
  // field so Garrison can stay in the dialer instead of context-switching.
  const handleConnected = useCallback(() => {
    if (!active) return;
    setConnectedDialogOpen(true);
  }, [active]);

  const handleConnectedSubmit = useCallback(
    async (args: {
      matterType: string | null;
      jurisdiction: string | null;
      summary: string | null;
      note: string | null;
      createMatter: boolean;
    }) => {
      if (!active) return;
      try {
        const result = await connectAndOptionallyConvert({
          leadId: active.id,
          matterType: args.createMatter ? args.matterType : null,
          jurisdiction: args.createMatter ? args.jurisdiction : null,
          summary: args.createMatter ? args.summary : null,
          note: args.note,
        });
        setConnectedDialogOpen(false);
        dispatch({
          type: "FLASH",
          flash: {
            kind: "ok",
            text: result.matterId
              ? `Matter created${result.noteAdded ? " + note saved" : ""} → next lead.`
              : `Marked connected${result.noteAdded ? " + note saved" : ""} → next lead.`,
          },
        });
        pendingAutoCallRef.current = true;
        dispatch({ type: "ADVANCE_TO_NEXT_LEAD" });
      } catch (e) {
        dispatch({
          type: "FLASH",
          flash: {
            kind: "error",
            text: e instanceof Error ? e.message : "Failed to record",
          },
        });
      }
    },
    [active],
  );

  const handleVoicemailDone = useCallback(async () => {
    if (!active) return;
    try {
      await markVoicemailLeft(active.id);
    } catch {
      /* logged server-side */
    }
    pendingAutoCallRef.current = true;
    dispatch({ type: "ADVANCE_TO_NEXT_LEAD" });
  }, [active]);

  // Manual "No answer" — fallback for when the Dialpad call-event webhook
  // isn't firing (subscription not yet configured, or delayed). One click
  // runs the FULL cadence: records the outcome, sends the no-answer SMS,
  // AND initiates the 2nd Dialpad call back-to-back. Saves Garrison from
  // having to click "Call now" a second time.
  const handleSendSchedulingLink = useCallback(
    async (channel: "sms" | "email") => {
      if (!active) return;
      dispatch({
        type: "FLASH",
        flash: {
          kind: "info",
          text: `Sending ${channel === "sms" ? "text" : "email"} with calendar invite…`,
        },
      });
      try {
        const result = await sendSchedulingLink(active.id, channel);
        dispatch({
          type: "FLASH",
          flash: {
            kind: result.sent ? "ok" : "error",
            text: result.sent
              ? `Calendar invite ${channel === "sms" ? "texted" : "emailed"}.`
              : `Send failed: ${result.error ?? "check config"}`,
          },
        });
      } catch (e) {
        dispatch({
          type: "FLASH",
          flash: {
            kind: "error",
            text: e instanceof Error ? e.message : "Send failed",
          },
        });
      }
    },
    [active],
  );

  const handleNoAnswer = useCallback(async () => {
    if (!active) return;
    dispatch({
      type: "FLASH",
      flash: { kind: "info", text: "Texting and ringing back…" },
    });
    try {
      const result = await triggerNoAnswerCadence(active.id);
      dispatch({
        type: "POLL_TICK",
        snap: {
          attempts: result.attempts,
          status: null,
          lastOutcome: "no_answer_1",
          needsVoicemail: false,
          historyLen: 0,
        },
      });
      dispatch({
        type: "FLASH",
        flash: {
          kind: "ok",
          text: result.secondCallInitiated
            ? result.smsSent
              ? "Text sent + ringing back now."
              : "Ringing back now (SMS did not send — check config)."
            : result.smsSent
              ? "Text sent. Second call did not initiate."
              : "No-answer recorded (text + 2nd call both failed — check config).",
        },
      });
    } catch (e) {
      dispatch({
        type: "FLASH",
        flash: {
          kind: "error",
          text:
            e instanceof Error
              ? `No-answer failed: ${e.message}`
              : "No-answer failed",
        },
      });
    }
  }, [active]);

  const handleSkip = useCallback(async () => {
    if (!active) return;
    const moved = active;
    const remaining = state.queue.filter((_, i) => i !== state.activeIndex);
    const movedItem = {
      ...moved,
      dialerStatus: "skipped" as const,
      dialerSkippedAt: new Date().toISOString(),
    };
    const newQueue = [...remaining, movedItem];
    pendingAutoCallRef.current = true;
    dispatch({
      type: "REPLACE_QUEUE",
      queue: newQueue,
      activeIndex: state.activeIndex,
    });
    try {
      await skipLead(moved.id);
    } catch (e) {
      dispatch({
        type: "FLASH",
        flash: {
          kind: "error",
          text:
            e instanceof Error
              ? `Skip not persisted: ${e.message}`
              : "Skip not persisted",
        },
      });
    }
  }, [active, state.queue, state.activeIndex]);

  const handleHold = useCallback(async () => {
    if (!active) return;
    const remaining = state.queue.filter((_, i) => i !== state.activeIndex);
    pendingAutoCallRef.current = true;
    dispatch({
      type: "REPLACE_QUEUE",
      queue: remaining,
      activeIndex: Math.min(state.activeIndex, remaining.length),
    });
    try {
      await holdLead(active.id, config.holdDaysDefault);
      dispatch({
        type: "FLASH",
        flash: {
          kind: "ok",
          text: `Held ${active.fullName} for ${config.holdDaysDefault} days.`,
        },
      });
    } catch (e) {
      dispatch({
        type: "FLASH",
        flash: {
          kind: "error",
          text:
            e instanceof Error ? `Hold failed: ${e.message}` : "Hold failed",
        },
      });
    }
  }, [active, state.queue, state.activeIndex, config.holdDaysDefault]);

  const handleRemove = useCallback(async () => {
    if (!active) return;
    const remaining = state.queue.filter((_, i) => i !== state.activeIndex);
    pendingAutoCallRef.current = true;
    dispatch({
      type: "REPLACE_QUEUE",
      queue: remaining,
      activeIndex: Math.min(state.activeIndex, remaining.length),
    });
    try {
      await removeLead(active.id);
      dispatch({
        type: "FLASH",
        flash: { kind: "ok", text: `Removed ${active.fullName} from queue.` },
      });
    } catch (e) {
      dispatch({
        type: "FLASH",
        flash: {
          kind: "error",
          text:
            e instanceof Error ? `Remove failed: ${e.message}` : "Remove failed",
        },
      });
    }
  }, [active, state.queue, state.activeIndex]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  const filterChips = (
    <FilterChips sources={sources} activeKey={activeFilterKey} totalActive={state.queue.length} />
  );

  if (state.queue.length === 0)
    return (
      <div className="space-y-4">
        {filterChips}
        <EmptyState />
      </div>
    );
  if (state.phase.kind === "queue_done") {
    return (
      <div className="space-y-4">
        {filterChips}
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          🎉 Queue cleared. Reload to refresh.
        </div>
      </div>
    );
  }
  if (!active) return <EmptyState />;

  const total = sources.reduce((sum, s) => sum + s.count, 0);
  const remaining = Math.max(0, state.queue.length - state.activeIndex);

  // Detect "mid-call" state for the mobile sticky bar — when in active call,
  // the outcome buttons (Connected / No-answer / Calendar invite / Not-a-fit)
  // matter most; otherwise primary actions (Call now / Skip / Hold).
  const inActiveCallTop =
    state.phase.kind === "calling_1" ||
    state.phase.kind === "cadence_running" ||
    state.phase.kind === "calling_2";

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      {filterChips}
      <ConnectedDialog
        open={connectedDialogOpen}
        onOpenChange={setConnectedDialogOpen}
        lead={active}
        onSubmit={handleConnectedSubmit}
      />

      {/* Mobile-only queue trigger — opens a sheet listing the queue.
          Hidden on md+ where the right rail is visible. */}
      <div className="md:hidden">
        <MobileQueueDrawer
          queue={state.queue}
          activeIndex={state.activeIndex}
          total={total}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <ActiveLeadCard
            lead={active}
            phase={state.phase}
            flash={state.flash}
            voicemailScript={config.voicemailScript}
            callScript={config.callScript}
            attorneyFirstName={config.attorneyFirstName}
            firmDisplayName={config.firmDisplayName}
            onCall={handleCall}
            onConnected={handleConnected}
            onNoAnswer={handleNoAnswer}
            onSendScheduling={handleSendSchedulingLink}
            onVoicemailDone={handleVoicemailDone}
            onSkip={handleSkip}
            onHold={handleHold}
            onRemove={handleRemove}
          />
        </div>

        {/* Right rail — desktop only. Mobile uses the drawer above. */}
        <aside className="hidden rounded-lg border bg-card md:block">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Queue
            </div>
            <div className="flex items-center gap-1.5 text-[10px] tabular-nums">
              <span className="text-muted-foreground">
                {remaining} of {state.queue.length} shown
              </span>
              {total > state.queue.length && (
                <Badge variant="outline" className="text-[10px]">
                  {total} dial-ready
                </Badge>
              )}
            </div>
          </div>
          <ol className="max-h-[520px] overflow-y-auto">
            {state.queue.map((lead, i) => (
              <li
                key={lead.id}
                className={`border-b last:border-0 ${
                  i === state.activeIndex ? "bg-primary/5" : ""
                } ${i < state.activeIndex ? "opacity-50" : ""}`}
              >
                <QueueItemPopover
                  lead={lead}
                  isActive={i === state.activeIndex}
                />
              </li>
            ))}
          </ol>
          <div className="border-t p-3">
            <DialerToolbar />
          </div>
        </aside>
      </div>

      {/* Sticky bottom action bar — mobile only. Mirrors the in-card buttons
          but always reachable with a thumb. Shows outcome buttons during a
          call, primary actions otherwise. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 px-3 py-2 shadow-lg backdrop-blur md:hidden">
        {inActiveCallTop ? (
          <div className="flex items-center gap-2">
            <Button
              size="lg"
              className="h-12 flex-1 gap-1.5 bg-emerald-600 text-base font-semibold hover:bg-emerald-700"
              onClick={handleConnected}
            >
              <PhoneIncoming className="h-5 w-5" />
              Connected
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 gap-1.5 text-sm font-semibold"
              onClick={handleNoAnswer}
              title="Send the no-answer text and ring back"
            >
              <MessageCircle className="h-5 w-5" />
              No ans
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 gap-1.5 text-sm font-semibold"
              onClick={() => handleSendSchedulingLink(active.phone ? "sms" : "email")}
              title="Send calendar invite"
            >
              <CalendarPlus className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="lg"
              className="h-12 flex-1 gap-2 text-base font-semibold"
              onClick={handleCall}
            >
              <PhoneCall className="h-5 w-5" />
              Call now
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 gap-1.5 text-sm font-semibold"
              onClick={handleSkip}
            >
              <SkipForward className="h-5 w-5" />
              Skip
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 gap-1.5 text-sm font-semibold"
              onClick={handleHold}
              title="Hold for 3 days"
            >
              <PauseCircle className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobileQueueDrawer — replaces the desktop right-rail on mobile. A summary
// button at top opens a Sheet showing the full queue.
// ---------------------------------------------------------------------------

function MobileQueueDrawer({
  queue,
  activeIndex,
  total,
}: {
  queue: DialerQueueItem[];
  activeIndex: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const remaining = Math.max(0, queue.length - activeIndex);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-xs"
          >
            <span className="font-semibold text-foreground">
              Queue · {remaining} of {queue.length} shown
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {total > queue.length && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  {total} dial-ready
                </span>
              )}
              <ChevronRightIcon />
            </span>
          </button>
        }
      />
      <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">
            Queue · {remaining} of {queue.length} shown
          </DialogTitle>
        </DialogHeader>
        <ol className="max-h-[60vh] overflow-y-auto">
          {queue.map((lead, i) => (
            <li
              key={lead.id}
              className={`border-b last:border-0 ${
                i === activeIndex ? "bg-primary/5" : ""
              } ${i < activeIndex ? "opacity-50" : ""}`}
            >
              <QueueItemPopover lead={lead} isActive={i === activeIndex} />
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Lead-score + time-of-day badges
// ---------------------------------------------------------------------------

function LeadScoreTierBadge({
  tier,
}: {
  tier: "hot" | "warm" | "cool" | "cold" | "unknown";
}) {
  const styles: Record<typeof tier, string> = {
    hot: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    warm: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    cool: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
    cold: "bg-muted text-muted-foreground border-border",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[tier]}`}
    >
      {tier}
    </span>
  );
}

function LocalHourBadge({
  localHour,
  score,
}: {
  localHour: number | null;
  score: number;
}) {
  if (localHour === null) {
    // Unknown timezone — don't render; the source/list badges carry enough.
    return null;
  }
  // Format as 12h with am/pm.
  const isPm = localHour >= 12;
  const display12 = localHour === 0 ? 12 : localHour > 12 ? localHour - 12 : localHour;
  const label = `${display12}${isPm ? "pm" : "am"} local`;
  const tone =
    score >= 100
      ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"
      : score >= 60
        ? "bg-muted text-foreground border-border"
        : "bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}
      title={
        score >= 100
          ? "Prime answer window"
          : score >= 60
            ? "Shoulder window"
            : "Off-hours — answer rate is lower"
      }
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// QueueItemPopover — click a right-rail lead to see details + Open Lead
// ---------------------------------------------------------------------------

function QueueItemPopover({
  lead,
  isActive,
}: {
  lead: DialerQueueItem;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs hover:bg-muted/40 ${
              isActive ? "font-medium" : ""
            }`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {lead.leadScore && lead.leadScore.tier !== "unknown" && (
                  <LeadScoreTierBadge tier={lead.leadScore.tier} />
                )}
                <span className="truncate">{lead.fullName}</span>
              </div>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {lead.phone}
              </span>
            </div>
            {(lead.dialerStatus === "skipped" ||
              lead.dialerAttempts > 0 ||
              lead.listName ||
              lead.localHour !== null) && (
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                {lead.localHour !== null && (
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      lead.timeOfDayScore >= 100
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-muted"
                    }`}
                  >
                    {(() => {
                      const h = lead.localHour;
                      const isPm = h >= 12;
                      const d12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return `${d12}${isPm ? "pm" : "am"}`;
                    })()}
                  </span>
                )}
                {lead.dialerStatus === "skipped" && (
                  <span className="rounded bg-muted px-1.5 py-0.5">skipped</span>
                )}
                {lead.dialerAttempts > 0 && (
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {lead.dialerAttempts} attempt
                    {lead.dialerAttempts === 1 ? "" : "s"}
                  </span>
                )}
                {lead.listName && (
                  <span className="truncate rounded bg-muted px-1.5 py-0.5">
                    {lead.listName}
                  </span>
                )}
              </div>
            )}
          </button>
        }
      />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate">{lead.fullName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground tabular-nums">
            {lead.phone}
            {lead.state ? ` · ${lead.state}` : ""}
            {lead.timezone ? ` · ${lead.timezone}` : ""}
          </p>
          {lead.email && (
            <p className="break-all text-xs text-muted-foreground">
              {lead.email}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px] capitalize">
              {lead.source}
            </Badge>
            {lead.listName && (
              <Badge variant="secondary" className="text-[10px]">
                {lead.listName}
              </Badge>
            )}
            {lead.dialerAttempts > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {lead.dialerAttempts} attempt
                {lead.dialerAttempts === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          {lead.matterType && (
            <p className="text-xs">
              <span className="text-muted-foreground">Matter:</span>{" "}
              <span className="font-medium">{lead.matterType}</span>
            </p>
          )}
          {lead.backgroundBrief && (
            <div className="rounded border border-amber-300/60 bg-amber-50/40 p-2 dark:border-amber-800/60 dark:bg-amber-950/15">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Brief
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed">
                {lead.backgroundBrief}
              </p>
            </div>
          )}
          {!lead.backgroundBrief &&
            lead.clientDescription &&
            lead.clientDescription !== "Pending Intake" && (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {lead.clientDescription}
              </p>
            )}
          {lead.recentMessages.length > 0 && (
            <div className="rounded border bg-card">
              <p className="border-b px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Initial message ({lead.recentMessages.length} total)
              </p>
              <p
                className={`max-h-[180px] overflow-y-auto whitespace-pre-wrap p-2 text-xs leading-relaxed ${
                  lead.recentMessages[0].isIntakeDump
                    ? "font-mono text-[11px]"
                    : ""
                }`}
              >
                {lead.recentMessages[0].content.slice(0, 1200)}
                {lead.recentMessages[0].content.length > 1200 ? "…" : ""}
              </p>
            </div>
          )}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
          <a
            href={`/leads/${lead.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open lead
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function FilterChips({
  sources,
  activeKey,
  totalActive,
}: {
  sources: DialerSourceBreakdown[];
  activeKey: string;
  totalActive: number;
}) {
  const allTotal = sources.reduce((sum, s) => sum + s.count, 0);

  function hrefFor(key: string): string {
    if (key === "all") return "/power-dialer";
    const [src, list] = key.split("::");
    const sp = new URLSearchParams();
    if (src) sp.set("source", src);
    if (list && list !== "_") sp.set("list", list);
    const qs = sp.toString();
    return qs ? `/power-dialer?${qs}` : "/power-dialer";
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Filter
      </span>
      <FilterChip
        href={hrefFor("all")}
        active={activeKey === "all"}
        label="All"
        count={allTotal}
      />
      {sources.map((s) => (
        <FilterChip
          key={s.key}
          href={hrefFor(s.key)}
          active={activeKey === s.key}
          label={s.label}
          count={s.count}
        />
      ))}
      {activeKey !== "all" && (
        <span className="text-[11px] text-muted-foreground">
          showing {totalActive}
        </span>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  // Plain <a> for hard navigation — Next.js client routing was unreliable
  // for this surface in earlier deploys.
  return (
    <a
      href={href}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span
        className={`tabular-nums ${active ? "opacity-90" : "text-muted-foreground"}`}
      >
        {count}
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Active lead card
// ---------------------------------------------------------------------------

function ActiveLeadCard({
  lead,
  phase,
  flash,
  voicemailScript,
  callScript,
  attorneyFirstName,
  firmDisplayName,
  onCall,
  onConnected,
  onNoAnswer,
  onSendScheduling,
  onVoicemailDone,
  onSkip,
  onHold,
  onRemove,
}: {
  lead: DialerQueueItem;
  phase: Phase;
  flash: Flash;
  voicemailScript: string;
  callScript: string;
  attorneyFirstName: string;
  firmDisplayName: string;
  onCall: () => void;
  onConnected: () => void;
  onNoAnswer: () => void;
  onSendScheduling: (channel: "sms" | "email") => void;
  onVoicemailDone: () => void;
  onSkip: () => void;
  onHold: () => void;
  onRemove: () => void;
}) {
  if (phase.kind === "voicemail") {
    return (
      <VoicemailCard
        lead={lead}
        flash={flash}
        script={voicemailScript}
        onVoicemailDone={onVoicemailDone}
        onTryAgain={onCall}
        onSkip={onSkip}
      />
    );
  }

  const inActiveCall =
    phase.kind === "calling_1" ||
    phase.kind === "cadence_running" ||
    phase.kind === "calling_2";
  const isIdle = phase.kind === "idle";

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{lead.fullName}</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {lead.phone}
            {lead.state ? ` · ${lead.state}` : ""}
            {lead.timezone ? ` · ${lead.timezone}` : ""} · added{" "}
            {formatRelativeTime(lead.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <a
            href={`/leads/${lead.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
          >
            <ExternalLink className="h-3 w-3" />
            Open lead
          </a>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {lead.leadScore && lead.leadScore.tier !== "unknown" && (
              <LeadScoreTierBadge tier={lead.leadScore.tier} />
            )}
            <LocalHourBadge
              localHour={lead.localHour}
              score={lead.timeOfDayScore}
            />
            <Badge variant="outline" className="text-[10px] capitalize">
              {lead.source}
            </Badge>
            {lead.listName && (
              <Badge variant="secondary" className="text-[10px]">
                {lead.listName}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Lead-score reasoning line — visible right under the header when
          present so Garrison sees WHY this lead is hot/warm/etc. */}
      {lead.leadScore &&
        lead.leadScore.tier !== "unknown" &&
        lead.leadScore.reasoning && (
          <div className="rounded-md border border-primary/15 bg-primary/[0.04] px-3 py-1.5 text-[11px] leading-relaxed">
            <span className="font-semibold uppercase tracking-wider text-primary/80">
              {lead.leadScore.tier}:
            </span>{" "}
            <span className="text-foreground/90">{lead.leadScore.reasoning}</span>
            {lead.leadScore.urgency_signals.length > 0 && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Urgency: {lead.leadScore.urgency_signals.join(" · ")}
              </p>
            )}
          </div>
        )}

      {/* Primary action row — at the top so it's accessible without
          scrolling, but understated so the script + brief remain the
          reading focus. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {isIdle && (
          <Button onClick={onCall} className="gap-2">
            <PhoneCall className="h-4 w-4" />
            Call now
          </Button>
        )}
        {phase.kind === "calling_1" && (
          <Button disabled className="gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Ringing…
          </Button>
        )}
        {phase.kind === "cadence_running" && (
          <Button disabled className="gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Texting + calling back…
          </Button>
        )}
        {phase.kind === "calling_2" && (
          <Button disabled className="gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Second call ringing…
          </Button>
        )}
        <Button onClick={onSkip} variant="outline" className="gap-2">
          <SkipForward className="h-4 w-4" />
          Skip
        </Button>
        <ConfirmActionButton
          label="Hold 3d"
          variant="outline"
          icon={<PauseCircle className="h-3.5 w-3.5" />}
          confirmTitle="Put on hold for 3 days?"
          confirmBody={`${lead.fullName} won't reappear in the dialer for 3 days. Useful if they asked for time or are unreachable.`}
          confirmCta="Hold 3 days"
          onConfirm={onHold}
        />
      </div>

      {/* Phase strip — sits right under the action bar so call status is
          visible next to the button that triggered it. */}
      <PhaseStrip phase={phase} flash={flash} />

      {/* Context */}
      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {lead.matterType && (
            <p className="col-span-2">
              <span className="text-muted-foreground">Matter:</span>{" "}
              <span className="font-medium">{lead.matterType}</span>
            </p>
          )}
          {lead.email && (
            <p className="col-span-2 truncate">
              <span className="text-muted-foreground">Email:</span>{" "}
              <span>{lead.email}</span>
            </p>
          )}
          {lead.state && (
            <p>
              <span className="text-muted-foreground">State:</span> {lead.state}
            </p>
          )}
          {lead.timezone && (
            <p>
              <span className="text-muted-foreground">TZ:</span> {lead.timezone}
            </p>
          )}
        </div>
        {lead.clientDescription &&
          lead.clientDescription !== "Pending Intake" ? (
          <p className="whitespace-pre-wrap pt-1 text-xs leading-relaxed text-foreground/90">
            {lead.clientDescription}
          </p>
        ) : !lead.latestInboundPreview ? (
          <p className="text-xs italic text-muted-foreground">
            No matter description yet. Use the script below as a starting point.
          </p>
        ) : null}
      </div>

      {/* Background brief — at-a-glance summary at the top.
          Pre-generated by Haiku from intake + messages; persisted on
          payload.dialer.background_brief. */}
      {lead.backgroundBrief && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/15">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Background brief
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {lead.backgroundBrief}
          </p>
        </div>
      )}

      {/* Structured call script — primary visual element, sits between the
          at-a-glance brief and the raw initial messages from the prospect. */}
      <StructuredScriptBlock
        lead={lead}
        attorneyFirstName={attorneyFirstName}
        firmDisplayName={firmDisplayName}
        fallbackTemplate={callScript}
      />

      {/* Always-visible thread excerpt — the prospect's actual words.
          Includes LegalMatch / Zapier intake dumps (their Q/A answers ARE
          the info), plus any outbound message we've actually sent. AI drafts
          still pending approval are filtered out so this never lies about
          contact history. */}
      {lead.recentMessages.length > 0 && (
        <ThreadExcerpt messages={lead.recentMessages} />
      )}

      {/* Quick note — capture call observations without leaving the dialer */}
      <QuickNoteRow leadId={lead.id} />

      {/* Outcome row — only shown while a call is active. Three actions:
          Connected (got on the call), No answer (manual fallback for when
          the Dialpad webhook doesn't fire — sends the cadence SMS now),
          and Not a fit (remove). */}
      {inActiveCall && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Call outcome:
          </span>
          <Button
            size="sm"
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={onConnected}
          >
            <PhoneIncoming className="h-3.5 w-3.5" />
            Connected
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onNoAnswer}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            No answer (text + ring back)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => onSendScheduling(lead.phone ? "sms" : "email")}
            title={
              lead.phone
                ? "Text the lead a link to book a call"
                : "Email the lead a link to book a call"
            }
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Send calendar invite
          </Button>
          <ConfirmActionButton
            label="Not a fit"
            variant="outline"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            confirmTitle="Remove from dialer queue?"
            confirmBody={`${lead.fullName} won't appear in the dialer again. The lead record stays in the CRM. This is for not-a-fit / disqualified leads.`}
            confirmCta="Remove from queue"
            destructive
            onConfirm={onRemove}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThreadExcerpt — always-visible panel showing the last 1-3 messages on the
// lead's conversation (both directions). LegalMatch / Zapier intake dumps
// get an "intake" badge and a scrollable preformatted body, since those
// are the prospect's Q/A answers and Garrison needs to see them verbatim.
// ---------------------------------------------------------------------------

function ThreadExcerpt({
  messages,
}: {
  messages: DialerQueueItem["recentMessages"];
}) {
  // messages came in newest-first; reverse so the conversation reads
  // chronologically top-to-bottom like a normal thread view.
  const ordered = [...messages].slice(0, 3).reverse();
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Initial messages ({messages.length})
      </div>
      <div className="max-h-[260px] divide-y overflow-y-auto">
        {ordered.map((m, i) => (
          <ThreadMessageRow key={`${m.createdAt}-${i}`} message={m} />
        ))}
      </div>
    </div>
  );
}

function ThreadMessageRow({
  message,
}: {
  message: DialerQueueItem["recentMessages"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const inbound = message.direction === "inbound";
  const fullBody = message.content;
  const isLong = fullBody.length > 320;
  const body = expanded || !isLong ? fullBody : fullBody.slice(0, 320) + "…";

  return (
    <div
      className={`px-3 py-2 ${
        inbound ? "bg-emerald-50/30 dark:bg-emerald-950/15" : "bg-muted/20"
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px]">
        <span
          className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${
            inbound
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {inbound ? "Prospect" : "We sent"}
        </span>
        {message.isIntakeDump && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            Intake
          </span>
        )}
        {message.channel && (
          <span className="rounded bg-background px-1.5 py-0.5 uppercase tracking-wider text-muted-foreground">
            {message.channel}
          </span>
        )}
        <span className="ml-auto tabular-nums text-muted-foreground">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
      <p
        className={`whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 ${
          message.isIntakeDump ? "font-mono text-[11px]" : ""
        }`}
      >
        {body}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-primary hover:underline"
        >
          {expanded ? "Show less" : `Show full (${fullBody.length} chars)`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structured call script — primary visual block on the dialer card.
// Reads pre-generated `lead.script` (Haiku, persisted on payload.dialer.script)
// and renders the 4-section layout. Falls back to a tiny inline template
// when the lead hasn't been backfilled yet.
// ---------------------------------------------------------------------------

function StructuredScriptBlock({
  lead,
  attorneyFirstName,
  firmDisplayName,
  fallbackTemplate,
}: {
  lead: DialerQueueItem;
  attorneyFirstName: string;
  firmDisplayName: string;
  fallbackTemplate: string;
}) {
  const script = lead.script;

  if (!script) {
    // Backfill-pending fallback — render the simple template, less visually
    // loud, so Garrison still has *something* to say.
    const firstName = guessFirstName(lead.fullName);
    const rendered = fillScriptTemplate(fallbackTemplate, {
      firstName,
      fullName: lead.fullName,
      attorneyFirstName,
      firmDisplayName,
      matter: lead.matterType,
      state: lead.state,
      listName: lead.listName,
    });
    return (
      <div className="rounded-md border border-primary/20 bg-primary/[0.04] p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Script (basic)
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {rendered}
        </p>
        <p className="mt-2 text-[10px] italic text-muted-foreground">
          AI script not generated yet for this lead — run the backfill.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border-2 border-primary/30 bg-primary/[0.04] p-4 shadow-sm">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Opening
        </p>
        <p className="text-[15px] leading-relaxed text-foreground">
          {script.opening}
        </p>
      </div>

      {script.situation.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Their situation
          </p>
          <ul className="space-y-0.5 text-sm leading-relaxed text-foreground/90">
            {script.situation.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {script.asks.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Ask
          </p>
          <ol className="space-y-1 text-sm leading-relaxed text-foreground">
            {script.asks.map((q, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {i + 1}.
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {script.close && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Close
          </p>
          <p className="text-[15px] leading-relaxed text-foreground">
            {script.close}
          </p>
        </div>
      )}
    </div>
  );
}

function guessFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") || /^\d/.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0] || null;
}

// ---------------------------------------------------------------------------
// Voicemail card
// ---------------------------------------------------------------------------

function VoicemailCard({
  lead,
  flash,
  script,
  onVoicemailDone,
  onTryAgain,
  onSkip,
}: {
  lead: DialerQueueItem;
  flash: Flash;
  script: string;
  onVoicemailDone: () => void;
  onTryAgain: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4 rounded-lg border-2 border-amber-300 bg-amber-50/60 p-5 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
          <Mic className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">
            Voicemail — read this after the beep
          </h2>
          <p className="text-xs text-muted-foreground">
            Calling {lead.fullName} · {lead.phone}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-amber-300 bg-card p-4 dark:border-amber-800">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
          {script}
        </p>
      </div>

      <PhaseStrip phase={{ kind: "voicemail" }} flash={flash} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onVoicemailDone} className="gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Voicemail left → next lead
        </Button>
        <Button onClick={onTryAgain} variant="outline" className="gap-2">
          <PhoneCall className="h-4 w-4" />
          Try again
        </Button>
        <Button onClick={onSkip} variant="ghost" className="gap-2">
          <SkipForward className="h-4 w-4" />
          Skip without VM
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase strip
// ---------------------------------------------------------------------------

function PhaseStrip({ phase, flash }: { phase: Phase; flash: Flash }) {
  let label: string | null = null;
  let icon: React.ReactNode = null;
  switch (phase.kind) {
    case "calling_1":
      label = "Ringing your Dialpad. Answer to connect.";
      icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
      break;
    case "cadence_running":
      label = "No answer — texting them and ringing back…";
      icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
      break;
    case "calling_2":
      label = "Second call ringing.";
      icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
      break;
    case "voicemail":
      label = "Two no-answers — read the voicemail script.";
      break;
    default:
      label = null;
  }

  if (!label && !flash) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {icon}
          {label}
        </p>
      )}
      {flash && (
        <p
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
            flash.kind === "ok"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : flash.kind === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {flash.text}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog wrapper
// ---------------------------------------------------------------------------

function ConfirmActionButton({
  label,
  icon,
  variant,
  size,
  confirmTitle,
  confirmBody,
  confirmCta,
  destructive,
  onConfirm,
}: {
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  confirmTitle: string;
  confirmBody: string;
  confirmCta: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isLarge = size === "lg";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size={size ?? "sm"}
            variant={variant ?? "outline"}
            className={isLarge ? "h-12 gap-2 text-sm font-semibold" : "gap-1.5"}
          >
            {icon}
            {label}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{confirmBody}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmCta}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Toolbar + empty state
// ---------------------------------------------------------------------------

function DialerToolbar() {
  return (
    <div className="space-y-1.5">
      <CsvImportDialog
        trigger={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-primary/5"
          >
            <Upload className="h-3.5 w-3.5" />
            Import via CSV
          </button>
        }
      />
      <button
        disabled
        title="Coming soon"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground"
      >
        <Users className="h-3.5 w-3.5" />
        Add leads from pipeline
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuickNoteRow — inline note capture on the dialer card. Saves to
// lead.payload.notes[] via addLeadNote so it appears on the lead detail page.
// ---------------------------------------------------------------------------

function QuickNoteRow({ leadId }: { leadId: string }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || saving) return;
    setError(null);
    setSaving(true);
    try {
      await addLeadNote(leadId, trimmed, "power_dialer");
      setDraft("");
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <StickyNote className="h-3 w-3" />
          Quick note
        </p>
        {savedAt && (
          <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
            ✓ saved
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What did they say? (wants Tue callback, mentioned 2018 trust...)"
          rows={2}
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          className="min-h-[44px] flex-1 resize-none text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void save()}
          disabled={!draft.trim() || saving}
          className="h-auto px-3 text-xs"
        >
          {saving ? "..." : "Save"}
        </Button>
      </div>
      {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectedDialog — opens when Garrison clicks "Connected" mid-call. Captures
// matter context + a note, and lets him either just-mark-connected or
// create-the-matter-on-the-fly without leaving the dialer.
// ---------------------------------------------------------------------------

function ConnectedDialog({
  open,
  onOpenChange,
  lead,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  lead: DialerQueueItem | null;
  onSubmit: (args: {
    matterType: string | null;
    jurisdiction: string | null;
    summary: string | null;
    note: string | null;
    createMatter: boolean;
  }) => Promise<void>;
}) {
  const [matterType, setMatterType] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"connect" | "matter" | null>(null);

  // Reset / prefill when the dialog opens for a new lead.
  useEffect(() => {
    if (!open || !lead) return;
    setMatterType(lead.matterType ?? "");
    setJurisdiction(lead.state ?? "");
    setSummary("");
    setNote("");
    setSubmitting(null);
  }, [open, lead]);

  if (!lead) return null;

  async function go(createMatter: boolean) {
    setSubmitting(createMatter ? "matter" : "connect");
    try {
      await onSubmit({
        matterType: matterType.trim() || null,
        jurisdiction: jurisdiction.trim() || null,
        summary: summary.trim() || null,
        note: note.trim() || null,
        createMatter,
      });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Call connected — {lead.fullName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Capture the matter and any call notes. Both are optional — &ldquo;Just
          mark connected&rdquo; advances to the next lead without creating a
          matter.
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Matter type
              </label>
              <Input
                value={matterType}
                onChange={(e) => setMatterType(e.target.value)}
                placeholder="e.g. estate_planning"
                disabled={submitting !== null}
                className="text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Jurisdiction
              </label>
              <Input
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. TX"
                disabled={submitting !== null}
                className="text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Matter summary
            </label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-line summary of the matter..."
              disabled={submitting !== null}
              className="text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Call notes (internal)
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was discussed, next steps, anything to remember..."
              rows={3}
              disabled={submitting !== null}
              className="min-h-[80px] resize-none text-sm"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting !== null}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void go(false)}
            disabled={submitting !== null}
          >
            {submitting === "connect" ? "Saving..." : "Just mark connected"}
          </Button>
          <Button
            size="sm"
            onClick={() => void go(true)}
            disabled={
              submitting !== null ||
              (!matterType.trim() && !jurisdiction.trim() && !summary.trim())
            }
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {submitting === "matter" ? "Creating..." : "Create matter & advance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border bg-card p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <PhoneCall className="h-5 w-5 text-primary" />
      </div>
      <h3 className="text-sm font-medium">No leads ready to dial</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Leads with status <span className="font-mono">new</span>, a phone
        number, and not removed/on-hold land here automatically.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <CsvImportDialog />
      </div>
    </div>
  );
}
