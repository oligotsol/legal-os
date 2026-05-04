/**
 * Simulate an inbound email by invoking processInboundMessage directly.
 * Bypasses webhook + integration_account checks so we can exercise the AI
 * draft + approval path before Postmark/Gmail credentials are wired up.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";

async function main() {
  const admin = createAdminClient();

  const fromEmail = process.argv[2] ?? "test.lead@example.com";
  const subject = process.argv[3] ?? "Question about estate planning";
  const body =
    process.argv[4] ??
    "Hi, my mother just passed and I need help figuring out her estate. " +
      "She lived in Texas. What does this kind of work cost? Thanks.";

  const result = await processInboundMessage({
    admin,
    candidateFirmIds: ["00000000-0000-0000-0000-000000000001"],
    channel: "email",
    fromIdentifier: fromEmail.toLowerCase().trim(),
    fromDisplayName: "Test Lead",
    body,
    externalMessageId: `sim_${Date.now()}`,
    source: "postmark",
    rawPayload: { subject, simulator: true },
    subjectHint: subject,
  });

  console.log("RESULT:", result);
}

main().catch((err) => {
  console.error("ERR:", err);
  process.exit(1);
});
