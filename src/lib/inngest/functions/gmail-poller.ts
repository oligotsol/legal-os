/**
 * Gmail poller — Inngest cron function that fetches unread emails and
 * hands them to the shared processInboundMessage helper.
 *
 * Per email:
 * 1. Fetch unread messages from Gmail API
 * 2. Idempotency check + raw event store
 * 3. Skip emails from the firm's own address (loop avoidance)
 * 4. Hand to processInboundMessage — which handles contact/lead/conversation
 *    resolution, ethics scan, drip cancel, AI draft, and notifications
 *    identically to the Dialpad SMS path
 * 5. Mark Gmail message as read; update sync cursor
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GmailCredentialsSchema,
  type GmailCredentials,
} from "@/lib/integrations/gmail/types";
import {
  listUnreadMessages,
  getFullMessage,
  markAsRead,
  extractEmail,
} from "@/lib/integrations/gmail/fetch";
import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";

// ---------------------------------------------------------------------------
// Cron — every 60 seconds
// ---------------------------------------------------------------------------

export const gmailPoller = inngest.createFunction(
  {
    id: "gmail-poller",
    retries: 1,
    triggers: [{ cron: "* * * * *" }],
  },
  async ({ step }) => {
    const admin = createAdminClient();

    const integrations = await step.run("fetch-gmail-integrations", async () => {
      const { data, error } = await admin
        .from("integration_accounts")
        .select("firm_id, credentials, id")
        .eq("provider", "gmail")
        .eq("status", "active");

      if (error)
        throw new Error(`Failed to fetch Gmail integrations: ${error.message}`);
      return data ?? [];
    });

    if (integrations.length === 0) return { processed: 0 };

    let totalProcessed = 0;

    for (const integration of integrations) {
      const processed = await step.run(
        `poll-firm-${integration.firm_id}`,
        async () => {
          return processGmailForFirm(
            admin,
            integration.firm_id,
            integration.id,
            integration.credentials as Record<string, unknown>,
          );
        },
      );
      totalProcessed += processed;
    }

    return { processed: totalProcessed };
  },
);

// ---------------------------------------------------------------------------
// Per-firm processing
// ---------------------------------------------------------------------------

async function processGmailForFirm(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  integrationAccountId: string,
  rawCredentials: Record<string, unknown>,
): Promise<number> {
  const credentials = GmailCredentialsSchema.parse(rawCredentials);

  const { data: syncState } = await admin
    .from("integration_sync_state")
    .select("cursor, id")
    .eq("firm_id", firmId)
    .eq("integration_account_id", integrationAccountId)
    .eq("sync_type", "gmail_poll")
    .maybeSingle();

  const messages = await listUnreadMessages(credentials, { maxResults: 10 });

  if (messages.length === 0) {
    if (syncState) {
      await admin
        .from("integration_sync_state")
        .update({ last_polled_at: new Date().toISOString() })
        .eq("id", syncState.id);
    }
    return 0;
  }

  // Look up the firm's own from-address once so we can skip self-loops.
  const firmFrom = await getFirmFromAddress(admin, firmId);

  let processed = 0;
  let latestMessageId = syncState?.cursor ?? null;

  for (const msgStub of messages) {
    try {
      const { data: existing } = await admin
        .from("webhook_events")
        .select("id")
        .eq("idempotency_key", `gmail_${msgStub.id}`)
        .maybeSingle();

      if (existing) continue;

      const email = await getFullMessage(credentials, msgStub.id);

      await admin.from("webhook_events").insert({
        firm_id: firmId,
        provider: "gmail",
        event_type: "email.inbound",
        payload: {
          messageId: email.messageId,
          threadId: email.threadId,
          from: email.from,
          fromEmail: email.fromEmail,
          to: email.to,
          subject: email.subject,
          textPreview: email.textBody.slice(0, 500),
          date: email.date,
        },
        status: "processing",
        idempotency_key: `gmail_${msgStub.id}`,
      });

      // Loop avoidance — never process emails the firm sent itself.
      if (firmFrom && email.fromEmail === firmFrom.toLowerCase()) {
        await markGmailEventProcessed(admin, msgStub.id);
        await markAsRead(credentials, msgStub.id);
        continue;
      }

      await processInboundMessage({
        admin,
        candidateFirmIds: [firmId],
        channel: "email",
        fromIdentifier: email.fromEmail,
        fromDisplayName: extractSenderName(email.from),
        body: email.textBody || email.subject,
        externalMessageId: email.messageId,
        source: "gmail",
        rawPayload: {
          subject: email.subject,
          text_preview: email.textBody.slice(0, 500),
          gmail_message_id: email.messageId,
          gmail_thread_id: email.threadId,
        },
        subjectHint: email.subject,
      });

      await markAsRead(credentials, msgStub.id);
      await markGmailEventProcessed(admin, msgStub.id);

      latestMessageId = msgStub.id;
      processed++;
    } catch (err) {
      console.error(`Failed to process Gmail message ${msgStub.id}:`, err);
      await admin
        .from("webhook_events")
        .update({
          status: "failed",
          processed_at: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        })
        .eq("idempotency_key", `gmail_${msgStub.id}`);
    }
  }

  await upsertSyncState(admin, firmId, integrationAccountId, latestMessageId);

  return processed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getFirmFromAddress(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", "email_config")
    .maybeSingle();

  const v = (data?.value as Record<string, unknown> | null)?.default_from;
  return typeof v === "string" ? v : null;
}

async function markGmailEventProcessed(
  admin: ReturnType<typeof createAdminClient>,
  gmailMessageId: string,
) {
  await admin
    .from("webhook_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("idempotency_key", `gmail_${gmailMessageId}`);
}

async function upsertSyncState(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  integrationAccountId: string,
  cursor: string | null,
) {
  const { data: existing } = await admin
    .from("integration_sync_state")
    .select("id")
    .eq("firm_id", firmId)
    .eq("integration_account_id", integrationAccountId)
    .eq("sync_type", "gmail_poll")
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    await admin
      .from("integration_sync_state")
      .update({
        cursor,
        last_polled_at: now,
        last_successful_at: now,
      })
      .eq("id", existing.id);
  } else {
    await admin.from("integration_sync_state").insert({
      firm_id: firmId,
      integration_account_id: integrationAccountId,
      sync_type: "gmail_poll",
      cursor,
      last_polled_at: now,
      last_successful_at: now,
      error_count: 0,
    });
  }
}

function extractSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return extractEmail(from);
}
