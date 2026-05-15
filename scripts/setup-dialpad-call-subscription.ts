/**
 * Set up Dialpad CALL-event webhook subscription.
 *
 * Mirrors scripts/setup-dialpad-webhook.ts (which handles SMS) but for the
 * call-state side. Without a call subscription, hangup/missed/voicemail
 * events never reach our webhook, so the power-dialer auto-cadence never
 * fires — Garrison has to manually click "No answer" after every missed
 * call.
 *
 * Idempotent: lists existing webhooks + call subscriptions first, reuses
 * or recreates as needed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/setup-dialpad-call-subscription.ts <https-url>
 *
 * The hook URL must be HTTPS and externally reachable. In production this
 * is the Vercel deployment URL. For local development, pass an ngrok URL.
 *
 *   npx tsx --env-file=.env.local scripts/setup-dialpad-call-subscription.ts \
 *     https://legal-os-one.vercel.app
 *
 * If the API key lacks the call_events scope, Dialpad returns 403 with a
 * descriptive message. In that case the user must re-issue the API key
 * from Dialpad admin with that scope toggled on, update integration_accounts
 * via scripts/update-dialpad-key.ts, then re-run this script.
 */

import { createClient } from "@supabase/supabase-js";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

async function dpFetch(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
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
  const base = process.argv[2];
  if (!base || !base.startsWith("https://")) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/setup-dialpad-call-subscription.ts <https-url>",
    );
    process.exit(1);
  }
  const hookUrl = `${base.replace(/\/$/, "")}/api/webhooks/dialpad`;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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
  // 1. Find or create the webhook record
  // ---------------------------------------------------------
  console.log("1. Listing existing webhooks...");
  const list = await dpFetch(apiKey, "GET", "/webhooks");
  if (!list.ok) {
    console.error("   Failed:", list.status, list.body);
    process.exit(1);
  }
  const items =
    (list.body as { items?: Array<{ id: string; hook_url: string }> }).items ?? [];
  console.log(`   Found ${items.length} existing webhook(s)`);

  let webhookId: string | undefined;
  const existing = items.find((w) => w.hook_url === hookUrl);
  if (existing) {
    webhookId = existing.id;
    console.log(`   Reusing existing webhook: ${webhookId}\n`);
  } else {
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
  // 2. List existing call subscriptions
  // ---------------------------------------------------------
  console.log("3. Listing existing CALL subscriptions...");
  const subList = await dpFetch(apiKey, "GET", "/subscriptions/call");
  if (!subList.ok) {
    if (subList.status === 403 || subList.status === 401) {
      console.error("\n   ✗ Failed with auth/scope error:", subList.status);
      console.error("   ", JSON.stringify(subList.body));
      console.error(
        "\n   The Dialpad API key likely lacks the scope to manage call subscriptions.",
      );
      console.error(
        "   Re-issue the API key from Dialpad admin with the call_events / call_state scope enabled,",
      );
      console.error(
        "   then update credentials via scripts/update-dialpad-key.ts and re-run this.",
      );
      process.exit(2);
    }
    console.error("   Failed:", subList.status, subList.body);
    process.exit(1);
  }
  const subs =
    (subList.body as {
      items?: Array<{
        id: string;
        webhook?: { id: string };
        enabled?: boolean;
        call_states?: string[];
      }>;
    }).items ?? [];
  console.log(`   Found ${subs.length} existing call subscription(s)`);

  const existingSub = subs.find((s) => s.webhook?.id === webhookId);
  if (existingSub) {
    console.log(
      `   Already subscribed: ${existingSub.id} (enabled=${existingSub.enabled})\n`,
    );
    console.log(`   call_states: ${JSON.stringify(existingSub.call_states ?? [])}\n`);
  } else {
    // ---------------------------------------------------------
    // 3. Create call subscription
    // ---------------------------------------------------------
    console.log("\n4. Creating call subscription...");
    // Subscribe to the states the cadence cares about: hangup / missed /
    // voicemail / preanswer. The webhook handler also tolerates 'calling'.
    const subBody = {
      webhook_id: webhookId,
      enabled: true,
      call_states: ["hangup", "missed", "voicemail", "preanswer"],
    };
    const sub = await dpFetch(apiKey, "POST", "/subscriptions/call", subBody);
    if (!sub.ok) {
      if (sub.status === 403 || sub.status === 401) {
        console.error("\n   ✗ Scope error creating call subscription:", sub.status);
        console.error("   ", JSON.stringify(sub.body));
        console.error(
          "\n   The Dialpad API key needs additional scope. Re-issue from Dialpad admin",
        );
        console.error(
          "   with the call-events scope enabled, then re-run this script.",
        );
        process.exit(2);
      }
      console.error("   Failed:", sub.status, sub.body);
      process.exit(1);
    }
    const subId = (sub.body as { id: string }).id;
    console.log(`   Created call subscription: ${subId}\n`);
  }

  console.log("Done. Call events will now drive the dialer cadence automatically.");
  console.log("Place a test call to an unanswered number and confirm the no-answer SMS fires within ~3s.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
