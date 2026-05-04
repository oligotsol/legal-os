/**
 * Live test: send a real email through the dispatchMessage path.
 * Use a real recipient address you control — this will actually deliver.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { dispatchMessage } from "@/lib/dispatch/outbound";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("usage: tsx scripts/test-gmail-dispatch.ts <recipient-email>");
    process.exit(1);
  }
  const r = await dispatchMessage("00000000-0000-0000-0000-000000000001", {
    channel: "email",
    to,
    from: "garrison@legacyfirstlaw.com",
    subject: "[Legal OS test] live Gmail dispatch",
    body: "This is a live test of the Legal OS Gmail send path. Reply to confirm round-trip works.",
  });
  console.log("RESULT:", r);
}
main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
