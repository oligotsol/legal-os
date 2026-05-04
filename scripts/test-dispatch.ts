import { config } from "dotenv";
config({ path: ".env.local" });

import { dispatchMessage } from "@/lib/dispatch/outbound";

async function main() {
  const r = await dispatchMessage("00000000-0000-0000-0000-000000000001", {
    channel: "sms",
    to: process.argv[2] ?? "+18475331869",
    from: "+12106107440",
    body: process.argv[3] ?? "[Legal OS test] dispatch path verified",
  });
  console.log("RESULT:", r);
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
