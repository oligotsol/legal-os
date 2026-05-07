/**
 * Simulate an inbound SMS through processInboundMessage. Mirror of
 * simulate-email-inbound.ts but on the SMS channel for doctrine testing.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";

async function main() {
  const admin = createAdminClient();

  const phone = process.argv[2] ?? `+1555${String(Date.now()).slice(-7)}`;
  const body =
    process.argv[3] ??
    "hi need help with a will. i live in TX, married, no kids, own a home. how much?";

  const result = await processInboundMessage({
    admin,
    candidateFirmIds: ["00000000-0000-0000-0000-000000000001"],
    channel: "sms",
    fromIdentifier: phone,
    fromDisplayName: null,
    body,
    externalMessageId: `sim_sms_${Date.now()}`,
    source: "dialpad",
    rawPayload: { simulator: true },
  });

  console.log("RESULT:", result);
}

main().catch((err) => {
  if (err instanceof Error && err.message.includes("INNGEST_EVENT_KEY")) {
    console.log("(known: Inngest event key throw post-draft — draft was created)");
    process.exit(0);
  }
  console.error("ERR:", err);
  process.exit(1);
});
