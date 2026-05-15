/**
 * Lex chat proxy.
 *
 * Browser-side widget → POST here → we resolve firm + page context (server
 * side, never trusting client-supplied record bodies) → check daily budget →
 * forward to the OpenClaw shim → return the JSON (or SSE stream) → log to
 * `ai_jobs` for cost tracking.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildLexSystemPrompt,
  loadFirmVoice,
  loadFirmSummary,
  type LexPageContext,
  type LexPageKind,
} from "@/lib/ai/lex-context";
import { checkLexBudget } from "@/lib/ai/lex-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LexChatRequest {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Page Lex is being asked from, e.g. "lead". */
  page?: LexPageKind;
  /** ID of the record on that page; we fetch the actual data server-side. */
  recordId?: string;
  /** Session id from prior turn (for memory continuity across requests). */
  sessionId?: string;
  /** Stream tokens as SSE (default true for typing-like UX). */
  stream?: boolean;
}

const VALID_PAGES: LexPageKind[] = [
  "lead",
  "conversation",
  "approval",
  "dashboard",
  "pipeline",
  "engagement",
  "power_dialer",
  "unknown",
];

export async function POST(req: NextRequest) {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!gatewayUrl || !gatewayToken) {
    return NextResponse.json(
      { error: "Lex not configured (missing OPENCLAW_GATEWAY_*)" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) {
    return NextResponse.json(
      { error: "User does not belong to a firm" },
      { status: 403 },
    );
  }
  const firmId = membership.firm_id;

  let payload: LexChatRequest;
  try {
    payload = (await req.json()) as LexChatRequest;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return NextResponse.json(
      { error: "messages[] required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Daily budget check — guards against runaway spend.
  const budget = await checkLexBudget(admin, firmId);
  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: `Lex daily budget exceeded ($${(budget.spentCents / 100).toFixed(2)} of $${(
          budget.capCents / 100
        ).toFixed(2)}). Resumes tomorrow.`,
      },
      { status: 429 },
    );
  }

  const page: LexPageKind =
    payload.page && VALID_PAGES.includes(payload.page) ? payload.page : "unknown";

  // Server-side record fetch — never trust client-supplied payload bodies.
  const record =
    page !== "unknown" && payload.recordId
      ? await fetchPageRecord(supabase, page, payload.recordId, firmId)
      : null;

  const lastUserMsg =
    [...payload.messages].reverse().find((m) => m.role === "user")?.content ??
    "";

  const voice = await loadFirmVoice(supabase, firmId);
  // Only fetch the firm snapshot when the question looks like it needs it,
  // and skip otherwise to save tokens on chitchat turns. Always fetch when
  // a specific record is in context — Lex needs to see neighbors / status.
  const summary =
    needsFirmSnapshot(lastUserMsg) || (page !== "unknown" && payload.recordId)
      ? await loadFirmSummary(supabase, firmId)
      : null;
  const pageCtx: LexPageContext = { kind: page, record };
  const systemPrompt = buildLexSystemPrompt(voice, pageCtx, summary);

  // Build the upstream request. We replace any client-supplied system
  // messages with our server-built one so the client can't override identity.
  const cleanMessages = payload.messages.filter((m) => m.role !== "system");

  const upstreamBody = {
    model: "lex-for-garrison",
    stream: payload.stream !== false,
    messages: [
      { role: "system", content: systemPrompt },
      ...cleanMessages,
    ],
    user: payload.sessionId ?? undefined,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Lex upstream unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "(no body)");
    return NextResponse.json(
      { error: `Lex upstream ${upstream.status}: ${text.slice(0, 300)}` },
      { status: 502 },
    );
  }

  // Non-streaming: parse, log, return.
  if (!upstreamBody.stream) {
    const json = await upstream.json();
    await logAiJob(admin, firmId, json, page, payload.recordId ?? null);
    return NextResponse.json(json);
  }

  // Streaming: pass-through, with a tee to capture usage for ai_jobs.
  if (!upstream.body) {
    return NextResponse.json(
      { error: "Lex upstream returned no body" },
      { status: 502 },
    );
  }

  const [forward, capture] = upstream.body.tee();
  // Fire-and-forget the capture stream → parse the [DONE]-preceding chunk for usage.
  void captureUsage(capture).then((usage) =>
    logAiJobFromUsage(
      admin,
      firmId,
      usage,
      page,
      payload.recordId ?? null,
    ).catch((err) =>
      console.error("[lex/chat] ai_jobs log failed:", err),
    ),
  );

  return new NextResponse(forward, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchPageRecord(
  supabase: Awaited<ReturnType<typeof createClient>>,
  page: LexPageKind,
  id: string,
  firmId: string,
): Promise<Record<string, unknown> | null> {
  // Firm-scoped read. RLS should also enforce this; we add the eq() for
  // belt-and-suspenders. Stripped to the columns we actually expose to Lex.
  switch (page) {
    case "lead":
    case "power_dialer": {
      const { data } = await supabase
        .from("leads")
        .select(
          "id, full_name, source, status, channel, email, phone, payload, contacts:contact_id(full_name, email, phone, state)",
        )
        .eq("id", id)
        .eq("firm_id", firmId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!data) return null;
      const c = (
        Array.isArray(data.contacts) ? data.contacts[0] : data.contacts
      ) as { full_name?: string; email?: string; phone?: string; state?: string } | null;
      const p = (data.payload ?? {}) as Record<string, unknown>;
      return {
        id: data.id,
        full_name: data.full_name ?? c?.full_name ?? null,
        source: data.source,
        status: data.status,
        channel: data.channel,
        email: data.email ?? c?.email ?? null,
        phone: data.phone ?? c?.phone ?? null,
        state: c?.state ?? null,
        city: p.city ?? null,
        matter_type: p.matter_type ?? null,
        client_description: p.client_description ?? null,
        list_name: p.list_name ?? null,
      };
    }
    case "conversation": {
      const { data } = await supabase
        .from("conversations")
        .select("id, channel, status, phase, message_count, last_message_at, contacts:contact_id(full_name)")
        .eq("id", id)
        .eq("firm_id", firmId)
        .maybeSingle();
      if (!data) return null;
      const c = (
        Array.isArray(data.contacts) ? data.contacts[0] : data.contacts
      ) as { full_name?: string } | null;
      return {
        id: data.id,
        contact_name: c?.full_name ?? null,
        channel: data.channel,
        status: data.status,
        phase: data.phase,
        message_count: data.message_count,
        last_message_at: data.last_message_at,
      };
    }
    case "approval": {
      const { data } = await supabase
        .from("approval_queue")
        .select("id, entity_type, action_type, priority, status, metadata")
        .eq("id", id)
        .eq("firm_id", firmId)
        .maybeSingle();
      return (data as Record<string, unknown>) ?? null;
    }
    default:
      return null;
  }
}

interface CapturedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
  cost_cents: number;
}

async function captureUsage(
  stream: ReadableStream<Uint8Array>,
): Promise<CapturedUsage> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let lastJson: Record<string, unknown> | null = null;
  let buf = "";
  for (;;) {
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
        if (obj?.usage) lastJson = obj;
      } catch {
        /* ignore non-JSON keepalives */
      }
    }
  }
  const usage =
    (lastJson?.usage as Record<string, number>) ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
  return {
    prompt_tokens: usage.prompt_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
    model: (lastJson?.model as string) ?? "lex-for-garrison",
    cost_cents: estimateCostCents(
      (lastJson?.model as string) ?? "",
      usage.prompt_tokens ?? 0,
      usage.completion_tokens ?? 0,
    ),
  };
}

async function logAiJob(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  resp: Record<string, unknown>,
  page: LexPageKind,
  recordId: string | null,
): Promise<void> {
  const usage = (resp.usage ?? {}) as Record<string, number>;
  const model = (resp.model as string) ?? "lex-for-garrison";
  const captured: CapturedUsage = {
    prompt_tokens: usage.prompt_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
    model,
    cost_cents: estimateCostCents(
      model,
      usage.prompt_tokens ?? 0,
      usage.completion_tokens ?? 0,
    ),
  };
  await logAiJobFromUsage(admin, firmId, captured, page, recordId);
}

async function logAiJobFromUsage(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  usage: CapturedUsage,
  page: LexPageKind,
  recordId: string | null,
): Promise<void> {
  await admin.from("ai_jobs").insert({
    firm_id: firmId,
    model: usage.model,
    purpose: "lex_chat",
    entity_type: page === "unknown" ? null : page,
    entity_id: recordId,
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    cost_cents: usage.cost_cents,
    status: "completed",
    request_metadata: { page },
    response_metadata: null,
    privileged: false,
  });
}

/**
 * Rough cost estimate. We don't yet know exactly what OpenClaw charges per
 * token (it's upstreamed via OpenRouter → Anthropic). For the daily-budget
 * cap we use Sonnet 4.6 rates: $3/M in, $15/M out. Refine later if Lex
 * surfaces actual billed cost in the response meta.
 */
function estimateCostCents(
  _model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const inputUsd = (promptTokens / 1_000_000) * 3.0;
  const outputUsd = (completionTokens / 1_000_000) * 15.0;
  return Math.round((inputUsd + outputUsd) * 10000) / 100; // cents, 2dp
}

/**
 * Heuristic: should we attach the full firm snapshot to this turn?
 * Yes when the user is asking about leads / approvals / conversations /
 * the pipeline; no for unrelated chitchat (saves ~1.5k input tokens).
 *
 * Per-page context is attached independently — this only gates the
 * full firm snapshot.
 */
function needsFirmSnapshot(userMessage: string): boolean {
  const m = userMessage.toLowerCase();
  if (m.length === 0) return false;
  const TRIGGER = [
    "lead",
    "leads",
    "approval",
    "approvals",
    "queue",
    "conversation",
    "conversations",
    "message",
    "messages",
    "pipeline",
    "matter",
    "matters",
    "client",
    "clients",
    "recent",
    "latest",
    "who",
    "list",
    "show me",
    "show",
    "find",
    "search",
    "summarize",
    "summary",
    "status",
    "pending",
    "new ",
    "today",
    "yesterday",
    "this week",
  ];
  return TRIGGER.some((kw) => m.includes(kw));
}
