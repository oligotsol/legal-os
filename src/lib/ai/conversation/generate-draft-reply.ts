/**
 * Channel-agnostic AI draft reply generator.
 *
 * Called by inbound-processing paths (Dialpad SMS webhook, Gmail poller,
 * Postmark inbound webhook) after an inbound message is persisted and the
 * ethics scan / drip-cancel work is done. Generates the AI reply, persists
 * it as `pending_approval`, logs the AI job, and either auto-approves +
 * dispatches (if the firm is in auto-approve mode) or queues for attorney
 * review.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { converse } from "@/lib/ai/converse";
import type {
  ConversationConfig,
  ConversationContext,
  PromptMessage,
} from "@/lib/ai/prompts/converse";
import { getApprovalMode } from "@/lib/approval-mode";
import { dispatchMessage } from "@/lib/dispatch/outbound";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface GenerateDraftReplyInput {
  admin: AdminClient;
  firmId: string;
  conversationId: string;
  contactId: string;
  newMessageContent: string;
  /** Email subject if this is an email conversation — used as Re: line on auto-dispatch. */
  subjectHint?: string | null;
}

export async function generateDraftReply(
  input: GenerateDraftReplyInput,
): Promise<void> {
  const {
    admin,
    firmId,
    conversationId,
    contactId,
    newMessageContent,
    subjectHint,
  } = input;

  const configKeys = [
    "conversation_config",
    "qualification_config",
    "negotiation_config",
    "scheduling_config",
  ];

  const { data: configs } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", configKeys);

  const configMap = Object.fromEntries(
    (configs ?? []).map((c) => [c.key, c.value as Record<string, unknown>]),
  );

  const convConfig = configMap.conversation_config ?? {};
  const qualConfig = configMap.qualification_config ?? {};
  const negConfig = configMap.negotiation_config ?? {};
  const schedConfig = configMap.scheduling_config ?? {};

  const { data: conversation } = await admin
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();
  if (!conversation) return;

  const { data: contact } = await admin
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (!contact) return;

  const { data: messageRows } = await admin
    .from("messages")
    .select("direction, sender_type, content, channel")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(50);

  const history: PromptMessage[] = (messageRows ?? []).map((m) => ({
    direction: m.direction as "inbound" | "outbound",
    senderType: m.sender_type as "contact" | "ai" | "attorney" | "system",
    content: m.content ?? "",
    channel: m.channel,
  }));

  const converseConfig: ConversationConfig = {
    model: (convConfig.model as string) ?? "sonnet",
    maxTokens: (convConfig.max_tokens as number) ?? 1024,
    temperature: (convConfig.temperature as number) ?? 0.7,
    firmName: (negConfig.firm_name as string) ?? "Legacy First Law PLLC",
    attorneyName: (negConfig.attorney_name as string) ?? "Garrison English",
    tone: (negConfig.tone as string) ?? "Professional and warm",
    keyPhrases: (negConfig.key_phrases as string[]) ?? [],
    competitiveAdvantages:
      (negConfig.competitive_advantages as string[]) ?? [],
    paymentOptions: (negConfig.payment_options as string[]) ?? [],
    turnaround: (negConfig.turnaround as string) ?? "7 business days",
    disqualifyRules: (negConfig.disqualify_rules as string[]) ?? [],
    referralRules: (negConfig.referral_rules as string[]) ?? [],
    qualifyingQuestions: (negConfig.qualifying_questions as string[]) ?? [],
    objectionScripts:
      (negConfig.objection_scripts as Record<string, string>) ?? {},
    escalationRules: {
      maxUnansweredMessages:
        ((qualConfig.escalation_rules as Record<string, unknown>)
          ?.max_unanswered_messages as number) ?? 3,
      escalationDelayHours:
        ((qualConfig.escalation_rules as Record<string, unknown>)
          ?.escalation_delay_hours as number) ?? 48,
      escalationTarget:
        ((qualConfig.escalation_rules as Record<string, unknown>)
          ?.escalation_target as string) ?? "attorney",
    },
    schedulingLink: (schedConfig.calendar_link as string) ?? "",
    bannedPhrases: (convConfig.banned_phrases as string[]) ?? [],
    smsCharLimit: (convConfig.sms_char_limit as number) ?? 300,
    casualnessLevel: (convConfig.casualness_level as number) ?? 2,
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

  const converseContext: ConversationContext = {
    conversationId,
    phase: conversation.phase,
    channel: conversation.channel,
    contactName: contact.full_name,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    contactState: contact.state,
    matterType: null,
    classificationConfidence: null,
    classificationSignals: null,
    messageCount: conversation.message_count,
    conversationContext: conversation.context,
  };

  try {
    const result = await converse(
      converseConfig,
      converseContext,
      history,
      newMessageContent,
    );

    const { data: draftMsg, error: draftErr } = await admin
      .from("messages")
      .insert({
        firm_id: firmId,
        conversation_id: conversationId,
        direction: "outbound",
        channel: result.response.suggested_channel,
        content: result.response.reply,
        sender_type: "ai",
        status: "pending_approval",
        ai_generated: true,
        metadata: {
          model: result.model,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_cents: result.costCents,
          phase_recommendation: result.response.phase_recommendation,
          next_phase: result.response.next_phase,
          escalation_signal: result.response.escalation_signal,
          escalation_reason: result.response.escalation_reason,
          reasoning: result.response.reasoning,
        },
      })
      .select("id")
      .single();

    if (draftErr || !draftMsg) {
      console.error("Failed to save AI draft:", draftErr);
      return;
    }

    await admin.from("ai_jobs").insert({
      firm_id: firmId,
      model: result.model,
      purpose: "converse",
      entity_type: "conversation",
      entity_id: conversationId,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: result.costCents,
      latency_ms: result.latencyMs,
      status: "completed",
      request_metadata: { message_count: history.length },
      response_metadata: {
        phase_recommendation: result.response.phase_recommendation,
        suggested_channel: result.response.suggested_channel,
        escalation_signal: result.response.escalation_signal,
      },
      privileged: false,
    });

    const approvalMode = await getApprovalMode(firmId, "message");

    if (approvalMode === "auto_approve") {
      await admin
        .from("messages")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .eq("id", draftMsg.id);

      try {
        const dispatchResult = await dispatchMessage(firmId, {
          channel: result.response.suggested_channel,
          to:
            result.response.suggested_channel === "sms"
              ? (contact.phone ?? "")
              : (contact.email ?? ""),
          from: "",
          body: result.response.reply,
          subject:
            result.response.suggested_channel === "email"
              ? `Re: ${
                  subjectHint ??
                  (conversation.context as Record<string, unknown> | null)
                    ?.subject ??
                  "Your inquiry"
                }`
              : undefined,
        });

        await admin
          .from("messages")
          .update({
            status: "sent",
            external_id: dispatchResult.result.messageId,
            sent_at: new Date().toISOString(),
          })
          .eq("id", draftMsg.id);
      } catch (dispatchErr) {
        console.error(
          "Auto-dispatch failed, falling back to approval queue:",
          dispatchErr,
        );
        await admin
          .from("messages")
          .update({ status: "pending_approval" })
          .eq("id", draftMsg.id);

        await admin.from("approval_queue").insert({
          firm_id: firmId,
          entity_type: "message",
          entity_id: draftMsg.id,
          action_type: "message",
          priority: 10,
          status: "pending",
          metadata: {
            contact_name: contact.full_name,
            channel: result.response.suggested_channel,
            content_preview: result.response.reply.slice(0, 200),
            phase: conversation.phase,
            auto_dispatch_failed: true,
          },
        });
      }
    } else {
      await admin.from("approval_queue").insert({
        firm_id: firmId,
        entity_type: "message",
        entity_id: draftMsg.id,
        action_type: "message",
        priority: result.response.escalation_signal ? 10 : 5,
        status: "pending",
        metadata: {
          contact_name: contact.full_name,
          channel: result.response.suggested_channel,
          content_preview: result.response.reply.slice(0, 200),
          phase: conversation.phase,
          escalation: result.response.escalation_signal,
        },
      });
    }
  } catch (err) {
    console.error("Failed to generate AI draft reply:", err);
  }
}
