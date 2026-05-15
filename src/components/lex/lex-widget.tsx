"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLexContext } from "./lex-context-provider";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "lex.widget.v1";
const MAX_TURNS = 30;

interface PersistedState {
  history: ChatTurn[];
  sessionId: string | null;
}

function loadPersisted(): PersistedState {
  if (typeof window === "undefined") return { history: [], sessionId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { history: [], sessionId: null };
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_TURNS) : [],
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
    };
  } catch {
    return { history: [], sessionId: null };
  }
}

function savePersisted(state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        history: state.history.slice(-MAX_TURNS),
        sessionId: state.sessionId,
      }),
    );
  } catch {
    /* localStorage full / private mode — ignore */
  }
}

export function LexWidget() {
  const pageCtx = useLexContext();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const s = loadPersisted();
    setHistory(s.history);
    setSessionId(s.sessionId);
  }, []);

  // Persist whenever history or sessionId changes.
  useEffect(() => {
    savePersisted({ history, sessionId });
  }, [history, sessionId]);

  // Auto-scroll on new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, streamingText, open]);

  // Cancel any in-flight stream when widget closes.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStreaming(false);
      setStreamingText("");
    }
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    const next: ChatTurn[] = [...history, { role: "user", content: text }];
    setHistory(next);
    setStreaming(true);
    setStreamingText("");

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/lex/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
          page: pageCtx.kind,
          recordId: pageCtx.recordId,
          sessionId,
          stream: true,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let newSessionId: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, "").trim();
          if (!line || line === "[DONE]") continue;
          try {
            const obj = JSON.parse(line);
            const delta = obj?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              acc += delta;
              setStreamingText(acc);
            }
            if (obj?.meta?.lex_session_id) {
              newSessionId = obj.meta.lex_session_id;
            }
          } catch {
            /* keepalive */
          }
        }
      }

      if (acc.length > 0) {
        setHistory((prev) => [...prev, { role: "assistant", content: acc }]);
      }
      if (newSessionId) setSessionId(newSessionId);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // closed mid-stream — drop the partial.
      } else {
        setError(e instanceof Error ? e.message : "Lex failed to respond");
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      abortRef.current = null;
    }
  }

  function clearHistory() {
    setHistory([]);
    setSessionId(null);
    savePersisted({ history: [], sessionId: null });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-xl shadow-violet-500/40 ring-2 ring-white/60 transition-transform hover:scale-105 dark:ring-zinc-900/60"
        aria-label="Open Lex chat"
      >
        <Sparkles className="h-6 w-6 animate-soft-pulse" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(70vh,640px)] w-[min(95vw,400px)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-violet-500/20 ring-1 ring-violet-500/20">
      <div className="flex items-center justify-between border-b bg-gradient-to-r from-violet-600/10 to-fuchsia-500/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="text-sm font-semibold">Lex</div>
          <span className="text-[10px] text-muted-foreground">
            COO · {pageCtx.kind !== "unknown" ? pageCtx.kind : "ready"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              title="Clear chat"
            >
              clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close Lex"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {history.length === 0 && !streamingText && (
          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            Hey, I&apos;m Lex. Ask me about{" "}
            {pageCtx.kind === "lead"
              ? "this lead"
              : pageCtx.kind === "conversation"
                ? "this conversation"
                : pageCtx.kind === "power_dialer"
                  ? "the dialer queue"
                  : "anything in the CRM"}
            , or have me draft a reply.
          </div>
        )}

        {history.map((t, i) => (
          <Bubble key={i} role={t.role} content={t.content} />
        ))}

        {streamingText && <Bubble role="assistant" content={streamingText} streaming />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="border-t bg-background/50 p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Lex…"
            rows={2}
            disabled={streaming}
            className="min-h-[44px] flex-1 resize-none border-2 border-violet-500/20 text-[13px] focus:border-violet-500/40 focus-visible:ring-violet-400/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            onClick={send}
            disabled={streaming || !input.trim()}
            className="h-9 w-9 shrink-0 bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm shadow-violet-500/30 hover:from-violet-700 hover:to-fuchsia-600"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter for newline · drafts only, you approve sends
        </p>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "border bg-muted/40"
        }`}
      >
        {content}
        {streaming && <span className="ml-0.5 inline-block animate-pulse">▌</span>}
      </div>
    </div>
  );
}
