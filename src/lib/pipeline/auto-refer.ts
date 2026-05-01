/**
 * Auto-refer — automatically handles referral dispositions from the ethics scanner.
 *
 * When the ethics scanner returns refer_amicus or refer_thaler:
 * 1. Transition matter to terminal referral stage
 * 2. Close conversation
 * 3. Generate referral message (requires attorney approval)
 * 4. Cancel pending drips
 * 5. Audit log
 */

import { cancelPendingDrips } from "./cancel-on-reply";

type AdminClient = ReturnType<
  typeof import("@/lib/supabase/admin").createAdminClient
>;

export type ReferralTarget = "amicus_lex" | "thaler";

export interface AutoReferInput {
  firmId: string;
  target: ReferralTarget;
  matterId: string | null;
  conversationId: string;
  contactId: string;
  leadId: string | null;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactState: string | null;
  matchedRule: string;
  matchedPatterns: string[];
}

export interface AutoReferResult {
  success: boolean;
  stageTransitioned: boolean;
  conversationClosed: boolean;
  messageId: string | null;
  approvalQueueId: string | null;
  dripsCancelled: number;
  error?: string;
}

/**
 * Map referral target to terminal pipeline stage slug.
 */
function targetToStageSlug(target: ReferralTarget): string {
  return target === "amicus_lex" ? "referred_amicus_lex" : "referred_thaler";
}

/**
 * Generate the referral message body.
 * Amicus Lex includes RPC 7.2(b) ownership disclosure.
 * Thaler is simpler.
 */
function generateReferralMessage(input: AutoReferInput): string {
  const greeting = `Hi ${input.contactName},`;

  if (input.target === "amicus_lex") {
    return `${greeting}

Thank you for reaching out to Legacy First Law. After reviewing your inquiry, I believe your matter involves litigation or a dispute, which falls outside our practice areas.

I'd like to refer you to Amicus Lex, a firm that specializes in dispute resolution and litigation. They'll be well-equipped to help you.

Disclosure pursuant to RPC 7.2(b): Legacy First Law PLLC and Amicus Lex are independently owned and operated law firms. This referral does not create an attorney-client relationship with Amicus Lex, and Legacy First Law receives no compensation for this referral.

If you have any questions, please don't hesitate to reach out.

Best regards`;
  }

  // Thaler referral
  return `${greeting}

Thank you for reaching out to Legacy First Law. After reviewing your inquiry, it looks like your matter involves trademark work that would be best handled by a specialist.

I'd like to refer you to Thaler Law, who focus specifically on trademark prosecution and protection. They'll take great care of you.

If you have any questions, please don't hesitate to reach out.

Best regards`;
}

/**
 * Execute an auto-referral.
 */
export async function executeAutoRefer(
  admin: AdminClient,
  input: AutoReferInput,
): Promise<AutoReferResult> {
  const result: AutoReferResult = {
    success: false,
    stageTransitioned: false,
    conversationClosed: false,
    messageId: null,
    approvalQueueId: null,
    dripsCancelled: 0,
  };

  try {
    // 1. Transition matter to terminal stage (if matter exists)
    if (input.matterId) {
      const targetSlug = targetToStageSlug(input.target);

      // Look up the target stage ID
      const { data: targetStage } = await admin
        .from("pipeline_stages")
        .select("id")
        .eq("firm_id", input.firmId)
        .eq("slug", targetSlug)
        .maybeSingle();

      if (targetStage) {
        // Get current matter to find from_stage_id
        const { data: matter } = await admin
          .from("matters")
          .select("stage_id")
          .eq("id", input.matterId)
          .eq("firm_id", input.firmId)
          .single();

        if (matter) {
          // Direct update (bypassing normal transition validation for auto-refer)
          await admin
            .from("matters")
            .update({
              stage_id: targetStage.id,
              status: "closed_lost",
              updated_at: new Date().toISOString(),
            })
            .eq("id", input.matterId)
            .eq("firm_id", input.firmId);

          // Insert stage history
          await admin.from("matter_stage_history").insert({
            firm_id: input.firmId,
            matter_id: input.matterId,
            from_stage_id: matter.stage_id,
            to_stage_id: targetStage.id,
            reason: `Auto-referred to ${input.target}: ${input.matchedRule}`,
          });

          result.stageTransitioned = true;
        }
      }
    }

    // 2. Close conversation
    const { error: closeErr } = await admin
      .from("conversations")
      .update({
        status: "closed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.conversationId)
      .eq("firm_id", input.firmId);

    if (!closeErr) {
      result.conversationClosed = true;
    }

    // 3. Generate referral message and save as pending_approval
    const referralBody = generateReferralMessage(input);

    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .insert({
        firm_id: input.firmId,
        conversation_id: input.conversationId,
        direction: "outbound",
        channel: input.contactEmail ? "email" : "sms",
        content: referralBody,
        sender_type: "ai",
        status: "pending_approval",
        ai_generated: true,
        metadata: {
          source: "auto_refer",
          referral_target: input.target,
          matched_rule: input.matchedRule,
        },
      })
      .select("id")
      .single();

    if (!msgErr && msg) {
      result.messageId = msg.id;

      // 4. Enqueue in approval_queue (attorney must review all referral comms)
      const { data: queueItem } = await admin
        .from("approval_queue")
        .insert({
          firm_id: input.firmId,
          entity_type: "message",
          entity_id: msg.id,
          action_type: "message",
          priority: 10, // high priority for referrals
          status: "pending",
          metadata: {
            contact_name: input.contactName,
            referral_target: input.target,
            matched_rule: input.matchedRule,
            matched_patterns: input.matchedPatterns,
            source: "auto_refer",
          },
        })
        .select("id")
        .single();

      if (queueItem) {
        result.approvalQueueId = queueItem.id;
      }
    }

    // 5. Cancel pending drips
    result.dripsCancelled = await cancelPendingDrips(
      admin,
      input.firmId,
      input.leadId,
      input.contactId,
    );

    // 6. Audit log
    await admin.from("audit_log").insert({
      firm_id: input.firmId,
      action: `pipeline.auto_referred.${input.target}`,
      entity_type: "conversation",
      entity_id: input.conversationId,
      after: {
        target: input.target,
        matched_rule: input.matchedRule,
        matched_patterns: input.matchedPatterns,
        matter_transitioned: result.stageTransitioned,
        conversation_closed: result.conversationClosed,
        drips_cancelled: result.dripsCancelled,
      },
    });

    result.success = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("Auto-refer failed:", err);
    return result;
  }
}
