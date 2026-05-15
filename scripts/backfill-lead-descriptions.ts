/**
 * One-off: generate a concise services-list description summary for every lead that
 * doesn't have one yet, and persist it to lead.payload.description_summary.
 *
 * Run from the legal-os repo root:
 *   npx tsx scripts/backfill-lead-descriptions.ts
 *
 * Uses Haiku (~$0.0005/lead). Logs each call to ai_jobs.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { summarizeLeadDescription } from "../src/lib/ai/summarize-lead";

async function main() {
  const admin = createAdminClient();

  const { data: leads, error } = await admin
    .from("leads")
    .select(
      "id, firm_id, source, channel, payload, contact_id, contacts:contact_id(state)",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch leads:", error.message);
    process.exit(1);
  }

  const candidates = (leads ?? []).filter((l) => {
    const p = (l.payload ?? {}) as Record<string, unknown>;
    return !p.description_summary;
  });

  console.log(
    `Found ${candidates.length} leads missing description_summary (of ${leads?.length ?? 0} total).`,
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalCostCents = 0;

  for (const lead of candidates) {
    const payload = (lead.payload ?? {}) as Record<string, unknown>;
    const contact = (
      Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
    ) as { state?: string } | null;

    // Pull the most recent inbound bodies for context.
    const { data: messages } = await admin
      .from("messages")
      .select("content, direction")
      .eq("firm_id", lead.firm_id)
      .in(
        "conversation_id",
        (
          (
            await admin
              .from("conversations")
              .select("id")
              .eq("lead_id", lead.id)
          ).data ?? []
        ).map((c) => c.id),
      )
      .eq("direction", "inbound")
      .order("created_at", { ascending: true })
      .limit(3);

    const recentMessages = (messages ?? [])
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter((m) => m.length > 0);

    try {
      const summary = await summarizeLeadDescription({
        matterType: (payload.matter_type as string | undefined) ?? null,
        clientDescription:
          (payload.client_description as string | undefined) ?? null,
        state: contact?.state ?? null,
        recentMessages,
        source: lead.source,
        channel: lead.channel,
      });

      if (summary.description === "Pending Intake" && summary.inputTokens === 0) {
        // Nothing to summarize — store the placeholder so we don't retry on
        // every backfill run.
        skipped++;
      }

      await admin
        .from("leads")
        .update({
          payload: { ...payload, description_summary: summary.description },
        })
        .eq("id", lead.id);

      if (summary.inputTokens > 0) {
        await admin.from("ai_jobs").insert({
          firm_id: lead.firm_id,
          model: summary.model,
          purpose: "summarize_lead",
          entity_type: "lead",
          entity_id: lead.id,
          input_tokens: summary.inputTokens,
          output_tokens: summary.outputTokens,
          cost_cents: summary.costCents,
          latency_ms: summary.latencyMs,
          status: "completed",
          request_metadata: { source: lead.source, channel: lead.channel, backfill: true },
          privileged: false,
        });
        totalCostCents += summary.costCents;
      }

      processed++;
      if (processed % 10 === 0) {
        console.log(`  ${processed}/${candidates.length} done…`);
      }
    } catch (err) {
      failed++;
      console.error(
        `  FAIL lead ${lead.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(
    `\nDone. processed=${processed} skipped=${skipped} failed=${failed} total_cost=$${(
      totalCostCents / 100
    ).toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
