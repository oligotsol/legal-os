/**
 * Post-Connected follow-up worker.
 *
 * Runs every 5 minutes. For each due scheduled_actions row with
 * metadata.type='post_connected_followup':
 *   1. Verify the lead is still in a state where follow-up makes sense
 *      (not converted, not removed; if either, mark cancelled).
 *   2. Generate the body (+ subject for email) via Haiku with firm voice
 *      doctrine.
 *   3. Insert a `messages` row with status='pending_approval' so Garrison
 *      reviews before send.
 *   4. Insert an `approval_queue` row so it shows up in /approvals.
 *   5. Mark the scheduled_action 'completed'.
 *
 * Best-effort: per-action try/catch. One bad row doesn't kill the cron.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateFollowupDraft } from "@/lib/ai/generate-followup-draft";

type AdminClient = ReturnType<typeof createAdminClient>;

export const postConnectedFollowupWorker = inngest.createFunction(
  {
    id: "post-connected-followup-worker",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const admin = createAdminClient();

    const due = await step.run("fetch-due", async () => {
      const { data, error } = await admin
        .from("scheduled_actions")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_for", new Date().toISOString())
        .filter("metadata->>type", "eq", "post_connected_followup")
        .order("scheduled_for", { ascending: true })
        .limit(50);
      if (error)
        throw new Error(`Failed to fetch due followups: ${error.message}`);
      return data ?? [];
    });

    if (due.length === 0) return { processed: 0 };

    let processed = 0;
    let cancelled = 0;
    let failed = 0;

    for (const action of due) {
      await step.run(`process-${action.id}`, async () => {
        try {
          const meta = (action.metadata ?? {}) as Record<string, unknown>;
          const stepNum = Number(meta.step) as 1 | 2 | 3;
          const channel = (meta.channel as "sms" | "email") ?? "email";
          const conversationId =
            (meta.conversation_id as string | undefined) ?? null;
          const callContextNote =
            (meta.call_context_note as string | undefined) ?? null;
          const firmId = action.firm_id as string;
          const leadId = action.lead_id as string | null;
          const contactId = action.contact_id as string | null;
          if (!leadId || !contactId) {
            await markAction(admin, action.id, "failed", "missing lead/contact");
            failed++;
            return;
          }

          // Verify the lead is still in scope for follow-up.
          const { data: lead } = await admin
            .from("leads")
            .select(
              "id, status, payload, contacts:contact_id(full_name, phone, email, dnc)",
            )
            .eq("id", leadId)
            .eq("firm_id", firmId)
            .is("deleted_at", null)
            .maybeSingle();
          if (!lead) {
            await markAction(admin, action.id, "cancelled", "lead missing");
            cancelled++;
            return;
          }
          const payload = (lead.payload ?? {}) as Record<string, unknown>;
          const dialer = (payload.dialer ?? {}) as Record<string, unknown>;
          if (
            lead.status === "converted" ||
            dialer.status === "removed" ||
            dialer.status === "converted"
          ) {
            await markAction(
              admin,
              action.id,
              "cancelled",
              "lead converted or removed",
            );
            cancelled++;
            return;
          }
          const contact = (
            Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts
          ) as {
            full_name: string | null;
            phone: string | null;
            email: string | null;
            dnc: boolean;
          } | null;
          if (contact?.dnc) {
            await markAction(admin, action.id, "cancelled", "dnc");
            cancelled++;
            return;
          }
          const recipient = channel === "sms" ? contact?.phone : contact?.email;
          if (!recipient) {
            await markAction(
              admin,
              action.id,
              "cancelled",
              `no ${channel} recipient`,
            );
            cancelled++;
            return;
          }

          // Pull firm config (voice doctrine + attorney/firm naming +
          // calendar link).
          const { data: cfgRows } = await admin
            .from("firm_config")
            .select("key, value")
            .eq("firm_id", firmId)
            .in("key", ["attorney", "voice_doctrine", "scheduling_config"]);
          const cfg: Record<string, Record<string, unknown>> = {};
          for (const r of cfgRows ?? [])
            cfg[r.key] = (r.value ?? {}) as Record<string, unknown>;
          const attorneyFirstName =
            (cfg.attorney?.first_name as string | undefined) ?? "the attorney";
          const firmDisplayName =
            (cfg.attorney?.display_firm_name as string | undefined) ?? "the firm";
          const voiceDoctrineRow = cfg.voice_doctrine ?? null;
          const voiceDoctrine =
            voiceDoctrineRow && voiceDoctrineRow.enabled !== false
              ? ((voiceDoctrineRow.content as string | undefined) ?? null)
              : null;
          const calendarLink =
            (cfg.scheduling_config?.calendar_link as string | undefined) ??
            null;
          const matterType =
            (payload.matter_type as string | undefined) ?? null;
          const descriptionSummary =
            (payload.description_summary as string | undefined) ?? null;
          const firstName = guessFirstName(contact?.full_name ?? null);

          // Generate the draft. calendarLink is only used for steps 2 + 3
          // per generate-followup-draft.ts — step 1 ignores it.
          const draft = await generateFollowupDraft({
            step: stepNum,
            channel,
            firstName,
            matterType,
            descriptionSummary,
            attorneyFirstName,
            firmDisplayName,
            callContextNote,
            voiceDoctrine,
            calendarLink,
          });

          // Resolve / create conversation for the chosen channel.
          let convoId = conversationId;
          if (!convoId) {
            const { data: existing } = await admin
              .from("conversations")
              .select("id")
              .eq("firm_id", firmId)
              .eq("lead_id", leadId)
              .eq("channel", channel)
              .in("status", ["active", "paused"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existing) {
              convoId = existing.id;
            } else {
              const { data: created } = await admin
                .from("conversations")
                .insert({
                  firm_id: firmId,
                  lead_id: leadId,
                  contact_id: contactId,
                  status: "active",
                  phase: "follow_up",
                  channel,
                  message_count: 0,
                })
                .select("id")
                .single();
              convoId = created?.id ?? null;
            }
          }
          if (!convoId) {
            await markAction(
              admin,
              action.id,
              "failed",
              "no conversation",
            );
            failed++;
            return;
          }

          // Insert message as pending_approval.
          const { data: msg, error: msgErr } = await admin
            .from("messages")
            .insert({
              firm_id: firmId,
              conversation_id: convoId,
              direction: "outbound",
              channel,
              content: draft.body,
              sender_type: "ai",
              ai_generated: true,
              status: "pending_approval",
              metadata: {
                purpose: "post_connected_followup",
                step: stepNum,
                ...(draft.subject ? { subject: draft.subject } : {}),
                model: draft.model,
                fell_back: draft.fellBack,
              },
            })
            .select("id")
            .single();
          if (msgErr || !msg) {
            await markAction(
              admin,
              action.id,
              "failed",
              `message insert: ${msgErr?.message}`,
            );
            failed++;
            return;
          }

          // Queue in approval_queue.
          await admin.from("approval_queue").insert({
            firm_id: firmId,
            entity_type: "message",
            entity_id: msg.id,
            action_type: "message",
            priority: 5,
            status: "pending",
            metadata: {
              contact_name: contact?.full_name ?? "Unknown",
              channel,
              summary:
                draft.body.length > 120
                  ? draft.body.slice(0, 120) + "…"
                  : draft.body,
              source: "post_connected_followup",
              step: stepNum,
            },
          });

          // AI-job ledger.
          if (draft.inputTokens > 0) {
            await admin.from("ai_jobs").insert({
              firm_id: firmId,
              model: draft.model,
              purpose: "post_connected_followup_draft",
              entity_type: "message",
              entity_id: msg.id,
              input_tokens: draft.inputTokens,
              output_tokens: draft.outputTokens,
              cost_cents: draft.costCents,
              latency_ms: draft.latencyMs,
              status: "completed",
              request_metadata: {
                step: stepNum,
                channel,
                fell_back: draft.fellBack,
              },
              privileged: false,
            });
          }

          await markAction(admin, action.id, "completed", null);
          processed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await markAction(admin, action.id, "failed", msg.slice(0, 400));
          failed++;
        }
      });
    }

    return { processed, cancelled, failed };
  },
);

async function markAction(
  admin: AdminClient,
  id: string,
  status: "completed" | "cancelled" | "failed",
  reason: string | null,
) {
  await admin
    .from("scheduled_actions")
    .update({
      status,
      cancelled_reason:
        status === "completed" ? null : reason ?? "(no reason)",
    })
    .eq("id", id);
}

function guessFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  if (/^[\d+]/.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0] || null;
}
