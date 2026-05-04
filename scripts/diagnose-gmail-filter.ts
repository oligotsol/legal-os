/**
 * Diagnose why the gmail-poller isn't seeing inbound mail.
 * Hits the live Gmail API with three different queries and reports
 * exactly what each returns. Tells us whether the email is reaching
 * Garrison's account, whether the label is applied, and whether
 * our query string format actually matches that label.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { GmailCredentialsSchema } from "@/lib/integrations/gmail/types";
import { getAccessToken } from "@/lib/integrations/gmail/email";

async function gmailQuery(token: string, q: string): Promise<unknown> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}

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

  // 1. List Gmail labels to see exact label IDs/names
  const labelsRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const labels = (labelsRes.labels ?? []) as Array<{ id: string; name: string }>;
  const intakeLabels = labels.filter((l) => /legal\s*os\s*intake|legal-os-intake/i.test(l.name));
  console.log("=== labels matching 'legal os intake' (case-insensitive) ===");
  if (intakeLabels.length === 0) {
    console.log("  NO MATCHING LABELS — the filter rule label doesn't exist in Gmail");
    console.log("  All custom labels:");
    for (const l of labels.filter((l) => !l.id.startsWith("CATEGORY_") && !["INBOX","SENT","DRAFT","TRASH","SPAM","UNREAD","STARRED","IMPORTANT","CHAT"].includes(l.id))) {
      console.log("   ·", l.name, "(id:", l.id + ")");
    }
  } else {
    for (const l of intakeLabels) console.log("  ·", l.name, "(id:", l.id + ")");
  }

  // 2. Query 1: most permissive — what's unread in inbox at all
  console.log("\n=== Q1: is:unread in:inbox -from:me (last 10) ===");
  const q1 = (await gmailQuery(token, "is:unread in:inbox -from:me")) as Record<string, unknown>;
  const m1 = (q1.messages ?? []) as Array<{ id: string }>;
  console.log("  count:", m1.length);
  // Fetch subjects for these
  for (const m of m1.slice(0, 5)) {
    const detail = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const headers = (detail.payload?.headers ?? []) as Array<{ name: string; value: string }>;
    const subj = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const lbls = (detail.labelIds ?? []) as string[];
    console.log("   ·", subj.slice(0, 80), "| from:", from.slice(0, 50), "| labels:", lbls.join(","));
  }

  // 3. Query 2: with the configured label (current firm_config value)
  const cfg = await admin.from("firm_config").select("value").eq("firm_id","00000000-0000-0000-0000-000000000001").eq("key","gmail_intake_label").single();
  const labelStr = (cfg.data?.value as { value?: string })?.value ?? "(missing)";
  console.log(`\n=== Q2: is:unread in:inbox -from:me label:${labelStr} (what poller actually queries) ===`);
  const q2 = (await gmailQuery(token, `is:unread in:inbox -from:me label:${labelStr}`)) as Record<string, unknown>;
  const m2 = (q2.messages ?? []) as Array<{ id: string }>;
  console.log("  count:", m2.length);
  console.log("  raw response:", JSON.stringify(q2).slice(0, 200));

  // 4. Query 3: try exact label string variants
  for (const variant of ["Legal-OS-Intake", "legal-os-intake", "Legal OS Intake", `"Legal OS Intake"`]) {
    const r = (await gmailQuery(token, `is:unread label:${variant}`)) as Record<string, unknown>;
    const c = ((r.messages ?? []) as unknown[]).length;
    console.log(`  variant "${variant}" → ${c} hits`);
  }
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
