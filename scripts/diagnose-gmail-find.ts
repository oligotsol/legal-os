/**
 * Find any emails matching common patterns in Garrison's Gmail.
 * Bypasses the poller's filter — pure read-only Gmail probe.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { GmailCredentialsSchema } from "@/lib/integrations/gmail/types";
import { getAccessToken } from "@/lib/integrations/gmail/email";

async function main() {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("integration_accounts")
    .select("credentials")
    .eq("firm_id", "00000000-0000-0000-0000-000000000001")
    .eq("provider", "gmail")
    .single();
  if (!row) throw new Error("no gmail integration");
  const creds = GmailCredentialsSchema.parse(row.credentials);
  const token = await getAccessToken(creds);

  const queries = [
    "newer_than:1d label:Legal-OS-Intake",
    "newer_than:1d -from:me label:Legal-OS-Intake",
    "from:oligotsol@gmail.com newer_than:1d",
    "from:oligotsol newer_than:1d",
    'subject:"New Lead" newer_than:1d',
    "newer_than:1h",
  ];

  for (const q of queries) {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(q)}`;
    const r = (await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())) as Record<string, unknown>;
    const msgs = (r.messages ?? []) as Array<{ id: string }>;
    console.log(`\nQ: "${q}" → ${msgs.length} hits`);
    for (const m of msgs.slice(0, 5)) {
      const detail = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then((r) => r.json());
      const headers = (detail.payload?.headers ?? []) as Array<{ name: string; value: string }>;
      const subj = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "";
      const date = headers.find((h) => h.name === "Date")?.value ?? "";
      const lbls = (detail.labelIds ?? []) as string[];
      console.log(`  · ${date} | ${subj.slice(0, 60)} | from: ${from.slice(0, 40)} | labels: ${lbls.join(",")}`);
    }
  }
}
main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
