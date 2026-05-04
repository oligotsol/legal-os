import { createClient } from "@supabase/supabase-js";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function dpFetch(apiKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(DIALPAD_BASE + path, {
    method,
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* leave */ }
  return { status: res.status, ok: res.ok, body: parsed };
}

async function main() {
  const ngrokBase = process.argv[2];
  if (!ngrokBase || !ngrokBase.startsWith("https://")) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/redo-dialpad-sms-subscription.ts <https://ngrok-url>");
    process.exit(1);
  }
  const hookUrl = ngrokBase + "/api/webhooks/dialpad";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env vars"); process.exit(1); }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: integration } = await supabase
    .from("integration_accounts")
    .select("credentials")
    .eq("firm_id", LFL_FIRM_ID).eq("provider", "dialpad").single();

  const apiKey = (integration?.credentials as { apiKey?: string })?.apiKey;
  if (!apiKey) { console.error("No api key in DB"); process.exit(1); }

  const list = await dpFetch(apiKey, "GET", "/webhooks");
  const items = (list.body as { items?: Array<{ id: string; hook_url: string }> }).items ?? [];
  const ours = items.find((w) => w.hook_url === hookUrl);
  if (!ours) { console.error("Webhook not found for", hookUrl); process.exit(1); }
  const webhookId = ours.id;
  console.log("1. Webhook:", webhookId);

  const subList = await dpFetch(apiKey, "GET", "/subscriptions/sms");
  const subs = (subList.body as { items?: Array<{ id: string; webhook?: { id: string } }> }).items ?? [];
  const ourSubs = subs.filter((s) => s.webhook?.id === webhookId);
  console.log("2. Found " + ourSubs.length + " existing subscriptions tied to our webhook");

  for (const s of ourSubs) {
    const subId = s.id;
    const del = await dpFetch(apiKey, "DELETE", "/subscriptions/sms/" + subId);
    console.log("   Deleted " + subId + " -> " + del.status);
  }

  const created = await dpFetch(apiKey, "POST", "/subscriptions/sms", {
    webhook_id: webhookId,
    direction: "inbound",
    enabled: true,
  });
  if (!created.ok) {
    console.error("3. Create failed:", created.status, created.body);
    process.exit(1);
  }
  const newId = (created.body as { id: string }).id;
  console.log("3. Created fresh subscription: " + newId);
  console.log("Done. Next inbound SMS should include text content.");
}

main().catch((err) => { console.error(err); process.exit(1); });
