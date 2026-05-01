/**
 * seed-lfl-pipeline.ts — Seed LFL 16-stage pipeline
 *
 * Seeds 16 pipeline stages with allowed_transitions for Legacy First Law.
 *
 * Usage:
 *   npx tsx scripts/seed-lfl-pipeline.ts
 *
 * Add to package.json scripts:
 *   "seed:lfl-pipeline": "npx tsx scripts/seed-lfl-pipeline.ts"
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent — uses upsert on (firm_id, slug).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

// =============================================================================
// Stage definitions
// =============================================================================

interface StageDef {
  slug: string;
  name: string;
  stage_type: "intake" | "qualification" | "negotiation" | "closing" | "post_close" | "terminal";
  display_order: number;
  sla_hours: number | null;
  is_terminal: boolean;
}

const STAGES: StageDef[] = [
  { slug: "new_lead", name: "New Lead", stage_type: "intake", display_order: 1, sla_hours: 2, is_terminal: false },
  { slug: "first_touch", name: "First Touch", stage_type: "intake", display_order: 2, sla_hours: null, is_terminal: false },
  { slug: "awaiting_reply", name: "Awaiting Reply", stage_type: "qualification", display_order: 3, sla_hours: 72, is_terminal: false },
  { slug: "in_conversation", name: "In Conversation", stage_type: "qualification", display_order: 4, sla_hours: 24, is_terminal: false },
  { slug: "fee_quoted", name: "Fee Quoted", stage_type: "negotiation", display_order: 5, sla_hours: 72, is_terminal: false },
  { slug: "negotiating", name: "Negotiating", stage_type: "negotiation", display_order: 6, sla_hours: 48, is_terminal: false },
  { slug: "engagement_sent", name: "Engagement Sent", stage_type: "closing", display_order: 7, sla_hours: 72, is_terminal: false },
  { slug: "engagement_signed", name: "Engagement Signed", stage_type: "closing", display_order: 8, sla_hours: 24, is_terminal: false },
  { slug: "payment_pending", name: "Payment Pending", stage_type: "closing", display_order: 9, sla_hours: 120, is_terminal: false },
  { slug: "paid_awaiting_intake", name: "Paid \u2014 Awaiting Intake", stage_type: "post_close", display_order: 10, sla_hours: 72, is_terminal: false },
  { slug: "intake_complete", name: "Intake Complete", stage_type: "post_close", display_order: 11, sla_hours: null, is_terminal: false },
  { slug: "consulted", name: "Consulted", stage_type: "post_close", display_order: 12, sla_hours: null, is_terminal: false },
  { slug: "referred_amicus_lex", name: "Referred \u2014 Amicus Lex", stage_type: "terminal", display_order: 13, sla_hours: null, is_terminal: true },
  { slug: "referred_thaler", name: "Referred \u2014 Thaler", stage_type: "terminal", display_order: 14, sla_hours: null, is_terminal: true },
  { slug: "do_not_contact", name: "Do Not Contact", stage_type: "terminal", display_order: 15, sla_hours: null, is_terminal: true },
  { slug: "lost_no_response", name: "Lost \u2014 No Response", stage_type: "terminal", display_order: 16, sla_hours: null, is_terminal: true },
];

// =============================================================================
// Transition rules (slug → list of allowed target slugs)
// =============================================================================

const TERMINAL_SLUGS = ["referred_amicus_lex", "referred_thaler", "do_not_contact", "lost_no_response"];

const TRANSITION_RULES: Record<string, string[]> = {
  new_lead: ["first_touch", ...TERMINAL_SLUGS],
  first_touch: ["awaiting_reply", "in_conversation", ...TERMINAL_SLUGS],
  awaiting_reply: ["in_conversation", "first_touch", ...TERMINAL_SLUGS],
  in_conversation: ["fee_quoted", "awaiting_reply", ...TERMINAL_SLUGS],
  fee_quoted: ["negotiating", "engagement_sent", ...TERMINAL_SLUGS],
  negotiating: ["fee_quoted", "engagement_sent", ...TERMINAL_SLUGS],
  engagement_sent: ["engagement_signed", "negotiating", ...TERMINAL_SLUGS],
  engagement_signed: ["payment_pending", ...TERMINAL_SLUGS],
  payment_pending: ["paid_awaiting_intake", ...TERMINAL_SLUGS],
  paid_awaiting_intake: ["intake_complete", ...TERMINAL_SLUGS],
  intake_complete: ["consulted", ...TERMINAL_SLUGS],
  consulted: [...TERMINAL_SLUGS],
};

// =============================================================================
// Main
// =============================================================================

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Seeding LFL 16-stage pipeline...\n");

  // ---------------------------------------------------------------
  // 1. Insert all 16 stages with empty allowed_transitions
  // ---------------------------------------------------------------
  const stageRows = STAGES.map((s) => ({
    firm_id: LFL_FIRM_ID,
    slug: s.slug,
    name: s.name,
    stage_type: s.stage_type,
    display_order: s.display_order,
    sla_hours: s.sla_hours,
    is_terminal: s.is_terminal,
    allowed_transitions: [] as string[],
  }));

  const { error: upsertErr } = await admin
    .from("pipeline_stages")
    .upsert(stageRows, { onConflict: "firm_id,slug" });

  if (upsertErr) {
    console.error("Failed to upsert pipeline stages:", upsertErr.message);
    process.exit(1);
  }
  console.log(`1. Upserted ${STAGES.length} pipeline stages`);

  // ---------------------------------------------------------------
  // 2. Fetch back all rows to get UUIDs
  // ---------------------------------------------------------------
  const { data: rows, error: fetchErr } = await admin
    .from("pipeline_stages")
    .select("id, slug")
    .eq("firm_id", LFL_FIRM_ID);

  if (fetchErr || !rows) {
    console.error("Failed to fetch pipeline stages:", fetchErr?.message);
    process.exit(1);
  }

  const slugToId = new Map(rows.map((r) => [r.slug, r.id as string]));
  console.log(`2. Resolved ${slugToId.size} stage UUIDs`);

  // ---------------------------------------------------------------
  // 3. Update allowed_transitions for each non-terminal stage
  // ---------------------------------------------------------------
  let updateCount = 0;
  for (const [slug, targetSlugs] of Object.entries(TRANSITION_RULES)) {
    const stageId = slugToId.get(slug);
    if (!stageId) {
      console.warn(`  Warning: stage "${slug}" not found — skipping transitions`);
      continue;
    }

    const targetIds = targetSlugs
      .map((ts) => slugToId.get(ts))
      .filter((id): id is string => id != null);

    const missingTargets = targetSlugs.filter((ts) => !slugToId.has(ts));
    if (missingTargets.length > 0) {
      console.warn(`  Warning: stage "${slug}" references unknown slugs: ${missingTargets.join(", ")}`);
    }

    const { error: updateErr } = await admin
      .from("pipeline_stages")
      .update({ allowed_transitions: targetIds })
      .eq("id", stageId);

    if (updateErr) {
      console.error(`  Failed to update transitions for "${slug}":`, updateErr.message);
    } else {
      updateCount++;
    }
  }
  console.log(`3. Updated allowed_transitions for ${updateCount} stages`);

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------
  console.log("\nPipeline seed complete.");
  console.log(`  ${STAGES.length} stages, ${updateCount} transition rules applied`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
