/**
 * Generate (or regenerate) the power-dialer assets for a single lead:
 *   - structured call script (opening / situation / asks / close)
 *   - 2-3 sentence background brief
 *
 * Persists both to `lead.payload.dialer` so the dialer card renders them
 * instantly without re-calling the model. Logs each AI call to `ai_jobs`
 * per CLAUDE.md #5.
 *
 * Designed to be called:
 *   - From process-inbound-message right after a NEW lead is created.
 *   - From CSV import scripts after a NEW lead row is inserted.
 *   - From backfills (the backfills also exist as standalone scripts that
 *     batch-process; this helper handles the per-lead path).
 *
 * Best-effort: catches and logs errors so the calling pipeline never fails
 * because of an AI hiccup. The dialer card has fallbacks for missing assets.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateCallScript } from "@/lib/ai/generate-call-script";
import { generateBackgroundBrief } from "@/lib/ai/generate-background-brief";
import { scoreLead } from "@/lib/ai/score-lead";

const MAX_INPUT_MESSAGES = 6;

export interface GenerateLeadDialerAssetsArgs {
  admin: SupabaseClient;
  firmId: string;
  leadId: string;
  /** If true, overwrites existing script / brief. Default false. */
  force?: boolean;
}

export async function generateLeadDialerAssets(
  args: GenerateLeadDialerAssetsArgs,
): Promise<{
  scriptGenerated: boolean;
  briefGenerated: boolean;
  scoreGenerated: boolean;
}> {
  const { admin, firmId, leadId, force = false } = args;

  try {
    // Lead + contact for context
    const { data: lead } = await admin
      .from("leads")
      .select(
        "id, full_name, source, status, payload, contact_id, contacts:contact_id(state, phone, email)",
      )
      .eq("id", leadId)
      .eq("firm_id", firmId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead)
      return {
        scriptGenerated: false,
        briefGenerated: false,
        scoreGenerated: false,
      };

    const payload = (lead.payload ?? {}) as Record<string, unknown>;
    const dialer = (payload.dialer ?? {}) as Record<string, unknown>;
    const needsScript = force || !dialer.script;
    const needsBrief = force || !dialer.background_brief;
    const needsScore = force || !payload.lead_score;
    if (!needsScript && !needsBrief && !needsScore) {
      return {
        scriptGenerated: false,
        briefGenerated: false,
        scoreGenerated: false,
      };
    }

    const contact = (
      Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
    ) as { state?: string; phone?: string | null; email?: string | null } | null;
    const fullName = (lead.full_name as string | null | undefined) ?? null;
    const firstName = guessFirstName(fullName);

    // Firm attorney / display name from firm_config — vertical-generic.
    const { data: cfg } = await admin
      .from("firm_config")
      .select("key, value")
      .eq("firm_id", firmId)
      .in("key", ["attorney"]);
    const cfgMap: Record<string, Record<string, unknown>> = {};
    for (const r of cfg ?? []) {
      cfgMap[r.key] = (r.value ?? {}) as Record<string, unknown>;
    }
    const attorneyFirstName =
      (cfgMap.attorney?.first_name as string | undefined) ?? "the attorney";
    const firmDisplayName =
      (cfgMap.attorney?.display_firm_name as string | undefined) ?? "the firm";

    // Recent messages for context (both directions, no intake filter).
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("lead_id", leadId);
    const convIds = (convs ?? []).map((c) => c.id);

    const recentMessages: Array<{
      direction: "inbound" | "outbound";
      content: string;
      channel: string | null;
      createdAt: string;
    }> = [];
    const recentInboundForScript: string[] = [];

    if (convIds.length > 0) {
      const { data: msgs } = await admin
        .from("messages")
        .select("content, direction, channel, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(MAX_INPUT_MESSAGES);

      for (const m of msgs ?? []) {
        const c = (m.content as string | null) ?? "";
        if (!c) continue;
        const direction =
          m.direction === "outbound" ? "outbound" : "inbound";
        recentMessages.push({
          direction,
          content: c,
          channel: (m.channel as string | null) ?? null,
          createdAt: m.created_at as string,
        });
        // For the script generator, pass inbound non-intake-dump bodies.
        // (Intake dumps go into the brief instead; the script generator
        // already has them via clientDescription / descriptionSummary.)
        if (direction === "inbound" && !looksLikeIntakeDump(c)) {
          recentInboundForScript.push(c);
        }
      }
    }

    const matterType =
      (payload.matter_type as string | undefined) ?? null;
    const descriptionSummary =
      (payload.description_summary as string | undefined) ?? null;
    const clientDescription =
      (payload.client_description as string | undefined) ?? null;
    const state = contact?.state ?? null;

    // Run all three generators in parallel — they're independent.
    const [scriptRes, briefRes, scoreRes] = await Promise.all([
      needsScript
        ? generateCallScript({
            attorneyFirstName,
            firmDisplayName,
            firstName,
            fullName,
            matterType,
            descriptionSummary,
            clientDescription,
            state,
            recentInbound: recentInboundForScript.slice(0, 2),
          }).catch((err) => {
            console.error("[lead-dialer-assets] script gen failed:", err);
            return null;
          })
        : Promise.resolve(null),
      needsBrief
        ? generateBackgroundBrief({
            firstName,
            fullName,
            state,
            matterType,
            descriptionSummary,
            clientDescription,
            recentMessages,
          }).catch((err) => {
            console.error("[lead-dialer-assets] brief gen failed:", err);
            return null;
          })
        : Promise.resolve(null),
      needsScore
        ? scoreLead({
            fullName,
            matterType,
            descriptionSummary,
            clientDescription,
            state,
            source: lead.source as string,
            listName: (payload.list_name as string | undefined) ?? null,
            recentInbound: recentInboundForScript.slice(0, 3),
            hasPhone: !!contact?.phone,
            hasEmail: !!contact?.email,
          }).catch((err) => {
            console.error("[lead-dialer-assets] score gen failed:", err);
            return null;
          })
        : Promise.resolve(null),
    ]);

    // Merge results into payload
    const newDialer = { ...dialer };
    if (scriptRes && scriptRes.script) {
      newDialer.script = scriptRes.script;
    }
    if (briefRes && briefRes.brief) {
      newDialer.background_brief = briefRes.brief;
      newDialer.background_brief_generated_at = new Date().toISOString();
    }
    const newPayload: Record<string, unknown> = {
      ...payload,
      dialer: newDialer,
    };
    if (scoreRes && scoreRes.score) {
      newPayload.lead_score = {
        ...scoreRes.score,
        generated_at: new Date().toISOString(),
        model: scoreRes.model,
        fell_back: scoreRes.fellBack,
      };
    }
    await admin
      .from("leads")
      .update({ payload: newPayload })
      .eq("id", leadId)
      .eq("firm_id", firmId);

    // ai_jobs ledger entries
    if (scriptRes && scriptRes.inputTokens > 0) {
      await admin.from("ai_jobs").insert({
        firm_id: firmId,
        model: scriptRes.model,
        purpose: "power_dialer_call_script",
        entity_type: "lead",
        entity_id: leadId,
        input_tokens: scriptRes.inputTokens,
        output_tokens: scriptRes.outputTokens,
        cost_cents: scriptRes.costCents,
        latency_ms: scriptRes.latencyMs,
        status: "completed",
        request_metadata: { source: "intake_pipeline", fell_back: scriptRes.fellBack },
        privileged: false,
      });
    }
    if (briefRes && briefRes.inputTokens > 0) {
      await admin.from("ai_jobs").insert({
        firm_id: firmId,
        model: briefRes.model,
        purpose: "power_dialer_background_brief",
        entity_type: "lead",
        entity_id: leadId,
        input_tokens: briefRes.inputTokens,
        output_tokens: briefRes.outputTokens,
        cost_cents: briefRes.costCents,
        latency_ms: briefRes.latencyMs,
        status: "completed",
        request_metadata: { source: "intake_pipeline", fell_back: briefRes.fellBack },
        privileged: false,
      });
    }
    if (scoreRes && scoreRes.inputTokens > 0) {
      await admin.from("ai_jobs").insert({
        firm_id: firmId,
        model: scoreRes.model,
        purpose: "lead_score",
        entity_type: "lead",
        entity_id: leadId,
        input_tokens: scoreRes.inputTokens,
        output_tokens: scoreRes.outputTokens,
        cost_cents: scoreRes.costCents,
        latency_ms: scoreRes.latencyMs,
        status: "completed",
        request_metadata: {
          source: "intake_pipeline",
          fell_back: scoreRes.fellBack,
          tier: scoreRes.score.tier,
        },
        privileged: false,
      });
    }

    return {
      scriptGenerated: !!scriptRes?.script,
      briefGenerated: !!briefRes?.brief,
      scoreGenerated: !!scoreRes?.score,
    };
  } catch (err) {
    console.error(`[lead-dialer-assets] unexpected error for lead ${leadId}:`, err);
    return {
      scriptGenerated: false,
      briefGenerated: false,
      scoreGenerated: false,
    };
  }
}

function guessFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") || /^\d/.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0] || null;
}

function looksLikeIntakeDump(text: string): boolean {
  if (!text) return false;
  return (
    text.includes("LEGALMATCH LEAD") ||
    text.includes("Parsed by Zapier") ||
    /^\s*New lead received/i.test(text) ||
    text.includes("CLIENT DESCRIPTION\n") ||
    text.includes("INTAKE ANSWERS")
  );
}
