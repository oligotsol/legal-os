/**
 * One-off: generate a 2-3 sentence "background brief" for every active
 * dial-ready lead and persist it to lead.payload.dialer.background_brief.
 *
 *   npx tsx scripts/backfill-background-briefs.ts
 *
 * Skips leads that already have a brief. Haiku, ~$0.0005/lead.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { generateBackgroundBrief } from "../src/lib/ai/generate-background-brief";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const admin = createAdminClient();

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
    const dialer = (p.dialer ?? {}) as { background_brief?: unknown };
    return !dialer.background_brief;
  });

  console.log(
    `Found ${candidates.length} leads without a background brief (of ${leads?.length ?? 0} active).`,
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

    // Pull up to 6 recent messages — both directions, NO intake-dump filter.
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("lead_id", lead.id);
    const convIds = (convs ?? []).map((c) => c.id);
    const recentMessages: Array<{
      direction: "inbound" | "outbound";
      content: string;
      channel: string | null;
      createdAt: string;
    }> = [];
    if (convIds.length > 0) {
      const { data: msgs } = await admin
        .from("messages")
        .select("content, direction, channel, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(6);
      for (const m of msgs ?? []) {
        const c = (m.content as string | null) ?? "";
        if (!c) continue;
        recentMessages.push({
          direction: m.direction === "outbound" ? "outbound" : "inbound",
          content: c,
          channel: (m.channel as string | null) ?? null,
          createdAt: m.created_at as string,
        });
      }
    }

    try {
      const result = await generateBackgroundBrief({
        firstName,
        fullName,
        state: contact?.state ?? null,
        matterType: (payload.matter_type as string | undefined) ?? null,
        descriptionSummary:
          (payload.description_summary as string | undefined) ?? null,
        clientDescription:
          (payload.client_description as string | undefined) ?? null,
        recentMessages,
      });

      const dialer = (payload.dialer ?? {}) as Record<string, unknown>;
      const newDialer = {
        ...dialer,
        background_brief: result.brief,
        background_brief_generated_at: new Date().toISOString(),
      };
      await admin
        .from("leads")
        .update({ payload: { ...payload, dialer: newDialer } })
        .eq("id", lead.id)
        .eq("firm_id", FIRM_ID);

      if (result.inputTokens > 0) {
        await admin.from("ai_jobs").insert({
          firm_id: FIRM_ID,
          model: result.model,
          purpose: "power_dialer_background_brief",
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
