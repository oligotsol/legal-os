/**
 * Diagnostic: look at the last N outbound email messages and tell us
 * what happened — sent? failed? dry-run? Still pending_approval?
 *
 *   npx tsx --env-file=.env.local scripts/check-recent-emails.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const admin = createAdminClient();

  const { data: msgs } = await admin
    .from("messages")
    .select(
      "id, status, external_id, content, created_at, sent_at, metadata, conversation_id",
    )
    .eq("firm_id", FIRM_ID)
    .eq("channel", "email")
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(15);

  if (!msgs || msgs.length === 0) {
    console.log("No outbound email messages found.");
    return;
  }

  console.log(`Last ${msgs.length} outbound email messages:\n`);
  for (const m of msgs) {
    const isDryRun =
      typeof m.external_id === "string" && m.external_id.startsWith("dry_run_");
    console.log(
      [
        `id=${m.id}`,
        `created=${m.created_at}`,
        `status=${m.status}`,
        m.sent_at ? `sent_at=${m.sent_at}` : "sent_at=null",
        isDryRun ? "DRY_RUN" : `external_id=${m.external_id ?? "null"}`,
      ].join(" | "),
    );
    if (m.content) {
      const preview = m.content.slice(0, 100).replace(/\n/g, " ");
      console.log(`   body: ${preview}${m.content.length > 100 ? "…" : ""}`);
    }
  }

  // Recent audit_log entries for message dispatch
  console.log("\n\nRecent message.dispatched / dispatch_failed audit rows:\n");
  const { data: audit } = await admin
    .from("audit_log")
    .select("action, entity_id, after, created_at")
    .eq("firm_id", FIRM_ID)
    .in("action", ["message.dispatched", "message.dispatch_failed"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (!audit || audit.length === 0) {
    console.log("(none in audit_log)");
  } else {
    for (const a of audit) {
      const after = a.after as Record<string, unknown> | null;
      console.log(
        `${a.created_at} | ${a.action} | msg=${a.entity_id} | ${JSON.stringify(after).slice(0, 220)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
