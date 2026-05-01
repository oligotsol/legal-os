/**
 * Drip worker — Inngest cron function that processes scheduled drip actions.
 *
 * Runs every 5 minutes. For each pending action:
 * 1. Check conversation is still in AWAITING_REPLY
 * 2. For AI drips: generate message via AI, save as pending_approval
 * 3. For Day 10 with no reply: schedule LOST_NO_RESPONSE transition
 * 4. Update scheduled_action status
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDripMessage } from "@/lib/ai/drip-message";
import type {
  ConversationConfig,
  PromptMessage,
} from "@/lib/ai/prompts/converse";

export const dripWorker = inngest.createFunction(
  {
    id: "drip-worker",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const admin = createAdminClient();

    // Fetch pending scheduled_actions that are due
    const pendingActions = await step.run("fetch-pending-actions", async () => {
      const { data, error } = await admin
        .from("scheduled_actions")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(50);

      if (error)
        throw new Error(`Failed to fetch pending actions: ${error.message}`);
      return data ?? [];
    });

    if (pendingActions.length === 0) return { processed: 0 };

    let processed = 0;

    for (const action of pendingActions) {
      await step.run(`process-action-${action.id}`, async () => {
        try {
          const meta = action.metadata as Record<string, unknown> | null;
          const conversationId = meta?.conversation_id as string | undefined;
          const dripDay = meta?.drip_day as number | undefined;
          const isAiDrip = meta?.type === "ai_drip";

          if (!conversationId || !action.contact_id) {
            // Missing data — mark as failed
            await admin
              .from("scheduled_actions")
              .update({ status: "failed", cancelled_reason: "missing_data" })
              .eq("id", action.id);
            return;
          }

          // Check conversation is still in awaiting_reply state
          const { data: conversation } = await admin
            .from("conversations")
            .select("id, status, phase, firm_id, lead_id, channel")
            .eq("id", conversationId)
            .maybeSingle();

          if (!conversation || conversation.status !== "active") {
            await admin
              .from("scheduled_actions")
              .update({
                status: "cancelled",
                cancelled_reason: "conversation_closed",
              })
              .eq("id", action.id);
            return;
          }

          // Fetch contact
          const { data: contact } = await admin
            .from("contacts")
            .select("*")
            .eq("id", action.contact_id)
            .single();

          if (!contact) {
            await admin
              .from("scheduled_actions")
              .update({
                status: "failed",
                cancelled_reason: "contact_not_found",
              })
              .eq("id", action.id);
            return;
          }

          if (isAiDrip && dripDay) {
            // Fetch firm config for AI generation
            const configKeys = [
              "conversation_config",
              "qualification_config",
              "negotiation_config",
              "scheduling_config",
            ];

            const { data: configs } = await admin
              .from("firm_config")
              .select("key, value")
              .eq("firm_id", action.firm_id)
              .in("key", configKeys);

            const configMap = Object.fromEntries(
              (configs ?? []).map((c) => [
                c.key,
                c.value as Record<string, unknown>,
              ]),
            );

            const convConfig = configMap.conversation_config ?? {};
            const negConfig = configMap.negotiation_config ?? {};
            const qualConfig = configMap.qualification_config ?? {};
            const schedConfig = configMap.scheduling_config ?? {};

            // Fetch message history
            const { data: messageRows } = await admin
              .from("messages")
              .select("direction, sender_type, content, channel")
              .eq("conversation_id", conversationId)
              .order("created_at", { ascending: true })
              .limit(50);

            const history: PromptMessage[] = (messageRows ?? []).map((m) => ({
              direction: m.direction as "inbound" | "outbound",
              senderType: m.sender_type as
                | "contact"
                | "ai"
                | "attorney"
                | "system",
              content: m.content ?? "",
              channel: m.channel,
            }));

            const converseConfig: ConversationConfig = {
              model: (convConfig.model as string) ?? "sonnet",
              maxTokens: (convConfig.max_tokens as number) ?? 1024,
              temperature: (convConfig.temperature as number) ?? 0.7,
              firmName:
                (negConfig.firm_name as string) ?? "Legacy First Law PLLC",
              attorneyName:
                (negConfig.attorney_name as string) ?? "Garrison English",
              tone:
                (negConfig.tone as string) ?? "Professional and warm",
              keyPhrases: (negConfig.key_phrases as string[]) ?? [],
              competitiveAdvantages:
                (negConfig.competitive_advantages as string[]) ?? [],
              paymentOptions: (negConfig.payment_options as string[]) ?? [],
              turnaround:
                (negConfig.turnaround as string) ?? "7 business days",
              disqualifyRules:
                (negConfig.disqualify_rules as string[]) ?? [],
              referralRules: (negConfig.referral_rules as string[]) ?? [],
              qualifyingQuestions:
                (negConfig.qualifying_questions as string[]) ?? [],
              objectionScripts:
                (negConfig.objection_scripts as Record<string, string>) ?? {},
              escalationRules: {
                maxUnansweredMessages:
                  ((
                    qualConfig.escalation_rules as Record<string, unknown>
                  )?.max_unanswered_messages as number) ?? 3,
                escalationDelayHours:
                  ((
                    qualConfig.escalation_rules as Record<string, unknown>
                  )?.escalation_delay_hours as number) ?? 48,
                escalationTarget:
                  ((
                    qualConfig.escalation_rules as Record<string, unknown>
                  )?.escalation_target as string) ?? "attorney",
              },
              schedulingLink:
                (schedConfig.calendar_link as string) ?? "",
              bannedPhrases:
                (convConfig.banned_phrases as string[]) ?? [],
              smsCharLimit:
                (convConfig.sms_char_limit as number) ?? 300,
              casualnessLevel:
                (convConfig.casualness_level as number) ?? 2,
              perJurisdictionSignOffs:
                (convConfig.per_jurisdiction_sign_offs as Record<
                  string,
                  { sms: string; email: string }
                >) ?? {},
              phoneNumber: (convConfig.phone_number as string) ?? "",
              firmFullName:
                (convConfig.firm_full_name as string) ??
                (negConfig.firm_name as string) ??
                "Legacy First Law PLLC",
            };

            // Generate AI drip message
            const dripResult = await generateDripMessage({
              firmId: action.firm_id,
              contactName: contact.full_name,
              contactEmail: contact.email,
              contactPhone: contact.phone,
              contactState: contact.state,
              matterType: null,
              conversationId,
              dayNumber: dripDay,
              config: converseConfig,
              history,
            });

            // Drip channel strategy — lock the drip to the conversation's
            // origin channel by default, fall back to whichever the lead has.
            // Configurable per-firm via firm_config.drip_channel_strategy.
            const strategy =
              ((convConfig.drip_channel_strategy as string) ?? "match_origin") as
                | "match_origin"
                | "ai_choice"
                | "prefer_email"
                | "prefer_sms";

            const dripChannel = pickDripChannel({
              strategy,
              aiSuggestion: dripResult.channel,
              conversationChannel: conversation.channel as "sms" | "email",
              hasPhone: Boolean(contact.phone),
              hasEmail: Boolean(contact.email),
            });

            // Save as pending_approval message
            const { data: draftMsg } = await admin
              .from("messages")
              .insert({
                firm_id: action.firm_id,
                conversation_id: conversationId,
                direction: "outbound",
                channel: dripChannel,
                content: dripResult.message,
                sender_type: "ai",
                status: "pending_approval",
                ai_generated: true,
                metadata: {
                  drip_day: dripDay,
                  model: dripResult.model,
                  input_tokens: dripResult.inputTokens,
                  output_tokens: dripResult.outputTokens,
                  cost_cents: dripResult.costCents,
                  source: "drip_worker",
                },
              })
              .select("id")
              .single();

            if (draftMsg) {
              // Enqueue for approval
              await admin.from("approval_queue").insert({
                firm_id: action.firm_id,
                entity_type: "message",
                entity_id: draftMsg.id,
                action_type: "message",
                priority: 5,
                status: "pending",
                metadata: {
                  contact_name: contact.full_name,
                  channel: dripResult.channel,
                  content_preview: dripResult.message.slice(0, 200),
                  drip_day: dripDay,
                  source: "drip_worker",
                },
              });

              // Log AI job
              await admin.from("ai_jobs").insert({
                firm_id: action.firm_id,
                model: dripResult.model,
                purpose: "converse",
                entity_type: "conversation",
                entity_id: conversationId,
                input_tokens: dripResult.inputTokens,
                output_tokens: dripResult.outputTokens,
                cost_cents: dripResult.costCents,
                status: "completed",
                request_metadata: { drip_day: dripDay },
                privileged: false,
              });
            }

            // Day 10 + no reply -> schedule lost_no_response transition
            if (dripDay === 10) {
              // This would trigger a transition — for now, we just log it
              // The actual transition happens when the approval is processed or expires
              await admin.from("audit_log").insert({
                firm_id: action.firm_id,
                action: "drip.final_followup",
                entity_type: "conversation",
                entity_id: conversationId,
                metadata: {
                  drip_day: 10,
                  next_action: "lost_no_response_if_no_reply",
                },
              });
            }
          }

          // Mark action as sent
          await admin
            .from("scheduled_actions")
            .update({ status: "sent" })
            .eq("id", action.id);

          processed++;
        } catch (err) {
          console.error(`Failed to process drip action ${action.id}:`, err);
          await admin
            .from("scheduled_actions")
            .update({
              status: "failed",
              cancelled_reason:
                err instanceof Error ? err.message : "unknown_error",
            })
            .eq("id", action.id);
        }
      });
    }

    return { processed };
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type DripChannelStrategy =
  | "match_origin"
  | "ai_choice"
  | "prefer_email"
  | "prefer_sms";

interface PickDripChannelInput {
  strategy: DripChannelStrategy;
  aiSuggestion: "sms" | "email";
  conversationChannel: "sms" | "email";
  hasPhone: boolean;
  hasEmail: boolean;
}

/**
 * Decide which channel to send a drip on, given the firm's strategy.
 *
 * - match_origin (default): use the conversation's origin channel
 * - ai_choice: trust whatever the AI picked
 * - prefer_email / prefer_sms: prefer one channel, fall back to the other
 *
 * In all strategies, if the lead is missing the preferred channel, we fall
 * back to the one that exists. If neither exists, we return the conversation
 * channel (caller-side validation will catch the dispatch failure).
 */
export function pickDripChannel({
  strategy,
  aiSuggestion,
  conversationChannel,
  hasPhone,
  hasEmail,
}: PickDripChannelInput): "sms" | "email" {
  const desired: "sms" | "email" = (() => {
    switch (strategy) {
      case "ai_choice":
        return aiSuggestion;
      case "prefer_email":
        return "email";
      case "prefer_sms":
        return "sms";
      case "match_origin":
      default:
        return conversationChannel;
    }
  })();

  if (desired === "sms" && !hasPhone && hasEmail) return "email";
  if (desired === "email" && !hasEmail && hasPhone) return "sms";
  return desired;
}
