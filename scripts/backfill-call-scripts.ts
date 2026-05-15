/**
 * One-off: generate a structured call script for every active dial-ready
 * lead and persist it to lead.payload.dialer.script.
 *
 *   npx tsx scripts/backfill-call-scripts.ts
 *
 * Skips leads that already have a script. Haiku, ~$0.001/lead.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import {
  generateCallScript,
  looksLikeIntakeDump,
} from "../src/lib/ai/generate-call-script";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const admin = createAdminClient();

  // Firm config — attorney name + firm display name.
  const { data: cfg } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", FIRM_ID)
    .in("key", ["attorney"]);
  const cfgMap: Record<string, Record<string, unknown>> = {};
  for (const r of cfg ?? []) cfgMap[r.key] = (r.value ?? {}) as Record<string, unknown>;
  const attorneyFirstName =
    (cfgMap.attorney?.first_name as string | undefined) ?? "the attorney";
  const firmDisplayName =
    (cfgMap.attorney?.display_firm_name as string | undefined) ?? "the firm";

  // Pull all active dial-ready leads.
  const { data: leads, error } = await admin
    .from("leads")
    .select(
      "id, full_name, source, status, payload, contact_id, contacts:contact_id(state)",
    )
    .is("deleted_at", null)
    .eq("status", "new")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Failed to fetch leads:", error.message);
    process.exit(1);
  }

  const candidates = (leads ?? []).filter((l) => {
    const p = (l.payload ?? {}) as Record<string, unknown>;
    const dialer = (p.dialer ?? {}) as { script?: unknown };
    return !dialer.script;
  });

  console.log(
    `Found ${candidates.length} leads without a call script (of ${leads?.length ?? 0} active).`,
  );

  let done = 0;
  let failed = 0;
  let totalCostCents = 0;

  for (const lead of candidates) {
    const payload = (lead.payload ?? {}) as Record<string, unknown>;
    const contact = (
      Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
    ) as { state?: string } | null;
    const fullName = (lead.full_name as string | null | undefined) ?? null;
    const firstName = guessFirstName(fullName);

    // Pull up to 2 recent inbound messages — skip intake dumps.
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("lead_id", lead.id);
    const convIds = (convs ?? []).map((c) => c.id);
    const recentInbound: string[] = [];
    if (convIds.length > 0) {
      const { data: msgs } = await admin
        .from("messages")
        .select("content")
        .in("conversation_id", convIds)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(5);
      for (const m of msgs ?? []) {
        const c = (m.content as string | null) ?? "";
        if (c && !looksLikeIntakeDump(c)) recentInbound.push(c);
        if (recentInbound.length >= 2) break;
      }
    }

    try {
      const result = await generateCallScript({
        attorneyFirstName,
        firmDisplayName,
        firstName,
        fullName,
        matterType: (payload.matter_type as string | undefined) ?? null,
        descriptionSummary:
          (payload.description_summary as string | undefined) ?? null,
        clientDescription:
          (payload.client_description as string | undefined) ?? null,
        state: contact?.state ?? null,
        recentInbound,
      });

      const dialer = (payload.dialer ?? {}) as Record<string, unknown>;
      const newDialer = { ...dialer, script: result.script };
      await admin
        .from("leads")
        .update({ payload: { ...payload, dialer: newDialer } })
        .eq("id", lead.id)
        .eq("firm_id", FIRM_ID);

      if (result.inputTokens > 0) {
        await admin.from("ai_jobs").insert({
          firm_id: FIRM_ID,
          model: result.model,
          purpose: "power_dialer_call_script",
          entity_type: "lead",
          entity_id: lead.id,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_cents: result.costCents,
          latency_ms: result.latencyMs,
          status: "completed",
          request_metadata: { backfill: true, fell_back: result.fellBack },
          privileged: false,
        });
        totalCostCents += result.costCents;
      }

      done++;
      if (done % 25 === 0) {
        console.log(`  ${done}/${candidates.length} done…`);
      }
    } catch (err) {
      failed++;
      console.error(
        `  lead ${lead.id} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(
    `\nDone. processed=${done} failed=${failed} ai_cost=$${(totalCostCents / 100).toFixed(4)}`,
  );
}

function guessFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+") || /^\d/.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0] || null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
