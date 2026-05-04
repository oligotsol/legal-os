import { config } from "dotenv";
config({ path: ".env.local" });

import { dispatchMessage } from "@/lib/dispatch/outbound";

async function main() {
  const r = await dispatchMessage("00000000-0000-0000-0000-000000000001", {
    channel: "email",
    to: process.argv[2] ?? "test.recipient@example.com",
    from: "garrison@legacyfirstlaw.com",
    subject: process.argv[3] ?? "[Legal OS test] email dispatch path",
    body: process.argv[4] ?? "Plain text body verifying the email dispatch flow.",
  });
  console.log("RESULT:", r);
}
main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
