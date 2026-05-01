/**
 * Set up Dialpad inbound SMS webhook + subscription.
 *
 * Idempotent: lists existing webhooks/subscriptions first, reuses or recreates
 * as needed. Reports clearly what it did.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/setup-dialpad-webhook.ts <ngrok-url>
 *
 * Example:
 *   npx tsx --env-file=.env.local scripts/setup-dialpad-webhook.ts \
 *     https://feed-penniless-acutely.ngrok-free.dev
 */

import { createClient } from "@supabase/supabase-js";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function dpFetch(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
) {
  const res = await fetch(`${DIALPAD_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }

  return { status: res.status, ok: res.ok, body: parsed };
}

async function main() {
  const ngrokBase = process.argv[2];
  if (!ngrokBase || !ngrokBase.startsWith("https://")) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/setup-dialpad-webhook.ts <https://ngrok-url>"
    );
    process.exit(1);
  }

  const hookUrl = `${ngrokBase}/api/webhooks/dialpad`;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pull the Dialpad API key from integration_accounts
  const { data: integration, error: intErr } = await supabase
    .from("integration_accounts")
    .select("credentials")
    .eq("firm_id", LFL_FIRM_ID)
    .eq("provider", "dialpad")
    .single();

  if (intErr || !integration) {
    console.error("Failed to load Dialpad integration:", intErr?.message);
    process.exit(1);
  }

  const credentials = integration.credentials as { apiKey?: string };
  const apiKey = credentials.apiKey;
  if (!apiKey) {
    console.error("No api_key in Dialpad integration credentials");
    process.exit(1);
  }

  console.log(`Hook URL:  ${hookUrl}`);
  console.log(`API base:  ${DIALPAD_BASE}\n`);

  // ---------------------------------------------------------
  // 1. List existing webhooks
  // ---------------------------------------------------------
  console.log("1. Listing existing webhooks...");
  const list = await dpFetch(apiKey, "GET", "/webhooks");
  if (!list.ok) {
    console.error("   Failed:", list.status, list.body);
    process.exit(1);
  }

  const items = (list.body as { items?: Array<{ id: string; hook_url: string }> })
    .items ?? [];
  console.log(`   Found ${items.length} existing webhook(s)`);

  let webhookId: string | undefined;
  const existing = items.find((w) => w.hook_url === hookUrl);
  if (existing) {
    webhookId = existing.id;
    console.log(`   Reusing existing webhook: ${webhookId}\n`);
  } else {
    // ---------------------------------------------------------
    // 2. Create new webhook
    // ---------------------------------------------------------
    console.log("\n2. Creating new webhook...");
    const create = await dpFetch(apiKey, "POST", "/webhooks", {
      hook_url: hookUrl,
    });
    if (!create.ok) {
      console.error("   Failed:", create.status, create.body);
      process.exit(1);
    }
    webhookId = (create.body as { id: string }).id;
    console.log(`   Created webhook: ${webhookId}\n`);
  }

  // ---------------------------------------------------------
  // 3. List existing SMS subscriptions
  // ---------------------------------------------------------
  console.log("3. Listing existing SMS subscriptions...");
  const subList = await dpFetch(apiKey, "GET", "/subscriptions/sms");
  if (!subList.ok) {
    console.error("   Failed:", subList.status, subList.body);
    process.exit(1);
  }

  const subs =
    (subList.body as {
      items?: Array<{
        id: string;
        direction: string;
        webhook?: { id: string };
      }>;
    }).items ?? [];
  console.log(`   Found ${subs.length} existing subscription(s)`);

  const existingSub = subs.find(
    (s) => s.webhook?.id === webhookId && (s.direction === "inbound" || s.direction === "all")
  );

  if (existingSub) {
    console.log(`   Already subscribed: ${existingSub.id} (${existingSub.direction})\n`);
  } else {
    // ---------------------------------------------------------
    // 4. Create SMS subscription
    // ---------------------------------------------------------
    console.log("\n4. Creating SMS subscription (direction=inbound)...");
    const sub = await dpFetch(apiKey, "POST", "/subscriptions/sms", {
      webhook_id: webhookId,
      direction: "inbound",
      enabled: true,
    });
    if (!sub.ok) {
      console.error("   Failed:", sub.status, sub.body);
      console.error(
        "\n   If this says 'message_content_export scope required',"
      );
      console.error(
        "   the API key needs to be re-issued with that scope in Dialpad admin."
      );
      process.exit(1);
    }
    const subId = (sub.body as { id: string }).id;
    console.log(`   Created subscription: ${subId}\n`);
  }

  console.log("Done. Send a test SMS to your LFL number now.");
  console.log("Watch the Next.js terminal for inbound webhook logs.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
