/**
 * One-off: replay generateDraftReply against an existing conversation
 * to reproduce / diagnose AI draft failures without waiting for a new SMS.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { generateDraftReply } from "../src/lib/ai/conversation/generate-draft-reply";

const CONVERSATION_ID = process.argv[2];
if (!CONVERSATION_ID) {
  console.error("usage: tsx scripts/replay-draft.ts <conversation_id>");
  process.exit(1);
}

async function main() {
  const admin = createAdminClient();

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, firm_id, contact_id")
    .eq("id", CONVERSATION_ID)
    .single();
  if (convErr || !conv) {
    console.error("Conversation not found:", convErr);
    process.exit(1);
  }

  const { data: lastInbound } = await admin
    .from("messages")
    .select("content")
    .eq("conversation_id", CONVERSATION_ID)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const body = lastInbound?.content ?? "";
  console.log("Replaying draft for:", { conv, body });

  await generateDraftReply({
    admin,
    firmId: conv.firm_id,
    conversationId: conv.id,
    contactId: conv.contact_id,
    newMessageContent: body,
  });

  console.log("Done. Check ai_jobs / messages / approval_queue for outcome.");
}

main().catch((err) => {
  console.error("REPLAY THREW:", err);
  process.exit(1);
});
