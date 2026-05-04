/**
 * One-off: report on the most-recent inbound SMS pipeline rows
 * (webhook_events, ai_jobs, messages, approval_queue).
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const heading = (s: string) => console.log("\n=== " + s + " ===");

  heading("webhook_events (last 5 dialpad)");
  const { data: events, error: eErr } = await admin
    .from("webhook_events")
    .select("id, status, error, processed_at, created_at, payload")
    .eq("provider", "dialpad")
    .order("created_at", { ascending: false })
    .limit(5);
  if (eErr) console.error(eErr);
  for (const e of events ?? []) {
    const text =
      typeof e.payload === "object" && e.payload !== null
        ? (e.payload as Record<string, unknown>).text
        : null;
    console.log({
      id: e.id,
      status: e.status,
      error: e.error,
      processed_at: e.processed_at,
      created_at: e.created_at,
      text,
    });
  }

  heading("ai_jobs (last 5 converse)");
  const { data: jobs } = await admin
    .from("ai_jobs")
    .select("id, status, error, model, entity_id, created_at")
    .eq("purpose", "converse")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const j of jobs ?? []) console.log(j);

  heading("messages (last 5 outbound ai_generated)");
  const { data: msgs } = await admin
    .from("messages")
    .select("id, status, channel, ai_generated, content, conversation_id, created_at")
    .eq("direction", "outbound")
    .eq("ai_generated", true)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const m of msgs ?? []) console.log({ ...m, content: (m.content as string | null)?.slice(0, 120) });

  heading("approval_queue (last 5 pending)");
  const { data: q } = await admin
    .from("approval_queue")
    .select("id, action_type, status, entity_type, entity_id, metadata, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const r of q ?? []) console.log(r);

  heading("messages (last 5 inbound)");
  const { data: inbound } = await admin
    .from("messages")
    .select("id, channel, content, conversation_id, created_at")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const m of inbound ?? []) console.log({ ...m, content: (m.content as string | null)?.slice(0, 120) });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
