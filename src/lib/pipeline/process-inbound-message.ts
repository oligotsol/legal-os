/**
 * Shared inbound-message processor.
 *
 * Single entry point for any inbound channel (Dialpad SMS, Gmail email,
 * Postmark inbound). Webhooks/pollers handle protocol-specific parsing
 * and idempotency, then hand a normalized payload to this function.
 *
 * Responsibilities:
 *   1. Resolve or create contact (by phone for SMS, by email for email)
 *   2. Resolve or create lead (for unknown senders)
 *   3. Resolve or create conversation
 *   4. Persist inbound message
 *   5. Run ethics scan
 *   6. On AUTO_DNC / HARD_BLOCK / refer / STOP_AI — handle and short-circuit
 *   7. Cancel pending drips on inbound reply (existing contacts)
 *   8. Fire lead.created event + approval-queue notification for new leads
 *
 * Returns enough state for the caller to log/audit and to know whether
 * the AI drafter should run next.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { scanMessage, type EthicsScanConfig } from "@/lib/ai/ethics-scanner";
import {
  loadJurisdictionConfig,
  routeLead,
} from "@/lib/leads/jurisdiction-routing";
import { cancelPendingDrips } from "@/lib/pipeline/cancel-on-reply";
import { executeAutoRefer } from "@/lib/pipeline/auto-refer";
import { generateDraftReply } from "@/lib/ai/conversation/generate-draft-reply";
import { summarizeLeadDescription } from "@/lib/ai/summarize-lead";
import { generateLeadDialerAssets } from "@/lib/pipeline/generate-lead-dialer-assets";
import { detectOptOutKeyword, recordOptOut } from "@/lib/sms/opt-outs";
import { inngest } from "@/lib/inngest/client";

type AdminClient = ReturnType<typeof createAdminClient>;

export type InboundChannel = "sms" | "email";

export interface ProcessInboundInput {
  admin: AdminClient;
  /** The set of firms whose integration triggered this inbound (for unknown-sender routing). */
  candidateFirmIds: string[];
  channel: InboundChannel;
  /** E.164 phone for SMS, lowercased email for email. */
  fromIdentifier: string;
  /** Display name for the contact when creating fresh (sender name from email, phone for SMS). */
  fromDisplayName?: string | null;
  /** The actual message body (plain text). */
  body: string;
  /** Provider's message id, used as `messages.external_id`. */
  externalMessageId?: string | null;
  /** Provider name (e.g. "dialpad", "gmail", "postmark") — stored on `leads.source`. */
  source: string;
  /** Anything provider-specific to retain on the lead row for debugging. */
  rawPayload?: Record<string, unknown>;
  /**
   * Optional override. If omitted, ethics config is loaded from
   * `firm_config.ethics_config` for the resolved firm. Per CLAUDE.md
   * non-negotiable #7: business rules are configuration, not hardcoded.
   */
  ethicsConfig?: EthicsScanConfig;
  /** Email subject for thread context — passed to AI draft generator for Re: lines. */
  subjectHint?: string | null;
  /**
   * If true, skips auto AI draft generation. Default false — both SMS and email
   * paths auto-draft to keep parity. Caller may set this for cases where draft
   * generation needs custom orchestration (e.g. classification has to run first).
   */
  skipDraftReply?: boolean;
}

export type ProcessInboundDisposition =
  | "ok"
  | "auto_dnc"
  | "auto_referred"
  | "escalated"
  | "dropped_jurisdiction";

export interface ProcessInboundResult {
  firmId: string;
  conversationId: string;
  contactId: string;
  leadId: string | null;
  isNewLead: boolean;
  disposition: ProcessInboundDisposition;
  /** True when the caller should NOT proceed to AI drafting (DNC / blocked / referred). */
  shortCircuit: boolean;
  ethicsDisposition: string;
  ethicsRecommendedAction?: string | null;
}

/**
 * Last-resort fallback used only when neither the caller nor the firm
 * has any ethics config set. Kept narrow on purpose — a real firm
 * onboarding should always populate `firm_config.ethics_config`. This
 * avoids the AI ever running without *some* compliance scanning if a
 * row is missing during a config-loader race.
 */
const FALLBACK_ETHICS_CONFIG: EthicsScanConfig = {
  activeJurisdictions: [],
  beebeGrandfatherActive: false,
  highValueThreshold: 0,
};

/**
 * Best-effort extraction of a state code from the inbound payload.
 *
 * Sources we know about today:
 *   - LegalMatch forwarded emails carry a "State" field in the parsed body
 *   - Manual CSV imports stamp payload.state
 *   - Inbound SMS rarely has state info -- returns null in that case
 *
 * Caller routes this through `routeLead`, which normalizes "Texas"/"tx"/"TX"
 * to "TX" and handles null/empty gracefully.
 */
function extractStateFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const direct = typeof p.state === "string" ? p.state : null;
  if (direct) return direct;
  const nested = p.lead as Record<string, unknown> | undefined;
  if (nested && typeof nested.state === "string") return nested.state;
  const parsed = p.parsed as Record<string, unknown> | undefined;
  if (parsed && typeof parsed.state === "string") return parsed.state;
  return null;
}

async function loadEthicsConfigForFirm(
  admin: AdminClient,
  firmId: string,
): Promise<EthicsScanConfig> {
  const { data } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", "ethics_config")
    .maybeSingle();
  if (!data?.value) {
    console.warn(
      `[processInboundMessage] no ethics_config row for firm ${firmId} — falling back to permissive defaults. Configure firm_config.ethics_config to enable jurisdiction/threshold checks.`,
    );
    return FALLBACK_ETHICS_CONFIG;
  }
  return data.value as EthicsScanConfig;
}

export async function processInboundMessage(
  input: ProcessInboundInput,
): Promise<ProcessInboundResult> {
  const {
    admin,
    candidateFirmIds,
    channel,
    fromIdentifier,
    fromDisplayName,
    body,
    externalMessageId,
    source,
    rawPayload,
    ethicsConfig: ethicsConfigOverride,
    subjectHint,
    skipDraftReply = false,
  } = input;

  if (candidateFirmIds.length === 0) {
    throw new Error("processInboundMessage requires at least one candidate firm id");
  }

  const contactColumn = channel === "sms" ? "phone" : "email";
  const leadIdentifierColumn = channel === "sms" ? "phone" : "email";

  // -------------------------------------------------------------------
  // Resolve contact across active firms
  // -------------------------------------------------------------------
  const { data: contact } = await admin
    .from("contacts")
    .select("*")
    .eq(contactColumn, fromIdentifier)
    .in("firm_id", candidateFirmIds)
    .limit(1)
    .maybeSingle();

  let contactId: string;
  let leadId: string | null = null;
  let firmId: string;
  let isNewLead = false;
  const contactState: string | null = contact?.state ?? null;

  if (contact) {
    contactId = contact.id;
    firmId = contact.firm_id;
  } else {
    firmId = candidateFirmIds[0];
    isNewLead = true;

    // Jurisdiction routing for the auto-intake path. We try to glean state
    // from the inbound payload (some sources -- LegalMatch, manual referrals
    // -- include a state field in the body). If it's outside the supported
    // set we DROP -- per the brief, leads from unserved states must not be
    // inserted. If state is unknown we insert unrouted; the conversation
    // flow can backfill state and attorney later.
    const jurisdictionConfig = await loadJurisdictionConfig(admin, firmId);
    const stateFromPayload = extractStateFromPayload(rawPayload);
    const routing = routeLead(stateFromPayload, jurisdictionConfig);
    if (routing.decision === "unsupported") {
      console.warn(
        `[process-inbound] dropping inbound lead from ${fromIdentifier}: state "${routing.normalizedState}" outside supported jurisdictions (${jurisdictionConfig.supportedStates.join(", ")})`,
      );
      return {
        firmId,
        conversationId: "",
        contactId: "",
        leadId: null,
        isNewLead: false,
        disposition: "dropped_jurisdiction",
        shortCircuit: true,
        ethicsDisposition: "skipped",
      };
    }

    const leadInsert: Record<string, unknown> = {
      firm_id: firmId,
      source,
      status: "new",
      channel,
      payload: rawPayload ?? { inbound: body },
      priority: 5,
      // Mirror the display name onto the lead row so the leads list doesn't
      // need to join `contacts` just to render a name. Fall back to the
      // identifier (phone/email) so the column is never null.
      full_name: fromDisplayName?.trim() || fromIdentifier,
      state: routing.normalizedState,
      assigned_attorney_name: routing.assignedAttorneyName,
    };
    leadInsert[leadIdentifierColumn] = fromIdentifier;

    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .insert(leadInsert)
      .select("id")
      .single();

    if (leadErr || !lead) {
      throw new Error(`Failed to create lead: ${leadErr?.message ?? "unknown"}`);
    }
    leadId = lead.id;

    const contactInsert: Record<string, unknown> = {
      firm_id: firmId,
      full_name: fromDisplayName?.trim() || fromIdentifier,
      source_lead_id: lead.id,
      dnc: false,
    };
    contactInsert[contactColumn] = fromIdentifier;

    const { data: newContact, error: contactErr } = await admin
      .from("contacts")
      .insert(contactInsert)
      .select("id")
      .single();

    if (contactErr || !newContact) {
      throw new Error(
        `Failed to create contact: ${contactErr?.message ?? "unknown"}`,
      );
    }
    contactId = newContact.id;

    await admin.from("leads").update({ contact_id: contactId }).eq("id", lead.id);
  }

  // -------------------------------------------------------------------
  // Resolve conversation
  // -------------------------------------------------------------------
  const { data: existingConvo } = await admin
    .from("conversations")
    .select("id")
    .eq("firm_id", firmId)
    .eq("contact_id", contactId)
    .eq("channel", channel)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  if (existingConvo) {
    conversationId = existingConvo.id;
  } else {
    const { data: newConvo, error: convoErr } = await admin
      .from("conversations")
      .insert({
        firm_id: firmId,
        lead_id: leadId,
        contact_id: contactId,
        status: "active",
        phase: "initial_contact",
        channel,
        message_count: 0,
      })
      .select("id")
      .single();

    if (convoErr || !newConvo) {
      throw new Error(
        `Failed to create conversation: ${convoErr?.message ?? "unknown"}`,
      );
    }
    conversationId = newConvo.id;
  }

  // -------------------------------------------------------------------
  // Persist inbound message
  // -------------------------------------------------------------------
  const { error: msgErr } = await admin.from("messages").insert({
    firm_id: firmId,
    conversation_id: conversationId,
    direction: "inbound",
    channel,
    content: body,
    sender_type: "contact",
    sender_id: contactId,
    status: "delivered",
    ai_generated: false,
    external_id: externalMessageId ?? null,
  });

  if (msgErr) {
    throw new Error(`Failed to insert message: ${msgErr.message}`);
  }

  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  // -------------------------------------------------------------------
  // Lead description summary — concise one-liner for the leads table.
  // Skip if not a new lead (existing lead already has its summary), and
  // skip on errors (non-fatal — leads list shows "Pending Intake" if null).
  // -------------------------------------------------------------------
  if (isNewLead && leadId) {
    try {
      const rawAny = (rawPayload ?? {}) as Record<string, unknown>;
      const summary = await summarizeLeadDescription({
        matterType: (rawAny.matter_type as string | undefined) ?? null,
        clientDescription: (rawAny.client_description as string | undefined) ?? null,
        state: contactState,
        recentMessages: [body],
        source,
        channel,
      });
      const mergedPayload = {
        ...rawAny,
        description_summary: summary.description,
      };
      await admin.from("leads").update({ payload: mergedPayload }).eq("id", leadId);
      await admin.from("ai_jobs").insert({
        firm_id: firmId,
        model: summary.model,
        purpose: "summarize_lead",
        entity_type: "lead",
        entity_id: leadId,
        input_tokens: summary.inputTokens,
        output_tokens: summary.outputTokens,
        cost_cents: summary.costCents,
        latency_ms: summary.latencyMs,
        status: "completed",
        request_metadata: { source, channel },
        privileged: false,
      });
    } catch (err) {
      console.error(
        `[processInboundMessage] summarizeLeadDescription failed for lead ${leadId}:`,
        err,
      );
    }

    // Power-dialer call script + at-a-glance background brief. Generated
    // once at intake so the dialer card is ready the moment Garrison picks
    // this lead up. Best-effort — failures are logged but don't block
    // intake (dialer card has fallback templates).
    try {
      await generateLeadDialerAssets({ admin, firmId, leadId });
    } catch (err) {
      console.error(
        `[processInboundMessage] generateLeadDialerAssets failed for lead ${leadId}:`,
        err,
      );
    }
  }

  // -------------------------------------------------------------------
  // Ethics scan — config is firm-specific, loaded from firm_config.
  // (CLAUDE.md non-negotiable #7: business rules are configuration.)
  // -------------------------------------------------------------------
  const ethicsConfig =
    ethicsConfigOverride ?? (await loadEthicsConfigForFirm(admin, firmId));

  const scanResult = scanMessage(
    {
      messageContent: body,
      contactState,
      estimatedValue: null,
      existingFlags: [],
    },
    ethicsConfig,
  );

  // AUTO_DNC — mark contact, close conversation, register phone-level
  // opt-out, stop.
  if (scanResult.disposition === "AUTO_DNC") {
    await admin.from("contacts").update({ dnc: true }).eq("id", contactId);
    await admin
      .from("conversations")
      .update({ status: "closed" })
      .eq("id", conversationId);

    // Phone-level opt-out (TCPA layer beyond contact.dnc). Detect the
    // specific STOP-style keyword the prospect used so it lands in
    // sms_opt_outs.trigger_keyword. Idempotent on (firm_id, phone_e164).
    if (channel === "sms") {
      const triggerKeyword = detectOptOutKeyword(body) ?? "auto_dnc";
      await recordOptOut({
        admin,
        firmId,
        phone: fromIdentifier,
        triggerKeyword,
        contactId,
      });
    }

    return {
      firmId,
      conversationId,
      contactId,
      leadId,
      isNewLead,
      disposition: "auto_dnc",
      shortCircuit: true,
      ethicsDisposition: scanResult.disposition,
      ethicsRecommendedAction: scanResult.recommendedAction,
    };
  }

  // HARD_BLOCK with referral.
  if (
    scanResult.disposition === "HARD_BLOCK" &&
    (scanResult.recommendedAction === "refer_amicus" ||
      scanResult.recommendedAction === "refer_thaler")
  ) {
    await executeAutoRefer(admin, {
      firmId,
      target:
        scanResult.recommendedAction === "refer_amicus"
          ? "amicus_lex"
          : "thaler",
      matterId: null,
      conversationId,
      contactId,
      leadId,
      contactName: contact?.full_name ?? fromDisplayName ?? fromIdentifier,
      contactEmail: contact?.email ?? (channel === "email" ? fromIdentifier : null),
      contactPhone: contact?.phone ?? (channel === "sms" ? fromIdentifier : null),
      contactState,
      matchedRule: scanResult.matchedRule,
      matchedPatterns: scanResult.matchedPatterns,
    });
    return {
      firmId,
      conversationId,
      contactId,
      leadId,
      isNewLead,
      disposition: "auto_referred",
      shortCircuit: true,
      ethicsDisposition: scanResult.disposition,
      ethicsRecommendedAction: scanResult.recommendedAction,
    };
  }

  // HARD_BLOCK / STOP_AI — escalate.
  if (
    scanResult.disposition === "HARD_BLOCK" ||
    scanResult.disposition === "STOP_AI"
  ) {
    await admin
      .from("conversations")
      .update({ status: "escalated" })
      .eq("id", conversationId);
    await admin.from("approval_queue").insert({
      firm_id: firmId,
      entity_type: "conversation",
      entity_id: conversationId,
      action_type: "other",
      priority: 10,
      status: "pending",
      metadata: {
        ethics_disposition: scanResult.disposition,
        recommended_action: scanResult.recommendedAction,
        matched_rule: scanResult.matchedRule,
        source: `ethics_scan_${source}`,
      },
    });
    return {
      firmId,
      conversationId,
      contactId,
      leadId,
      isNewLead,
      disposition: "escalated",
      shortCircuit: true,
      ethicsDisposition: scanResult.disposition,
      ethicsRecommendedAction: scanResult.recommendedAction,
    };
  }

  // -------------------------------------------------------------------
  // PARTNER_REVIEW — surface ethics signals on the conversation so the
  // attorney can act on them without blocking the AI reply path.
  // -------------------------------------------------------------------
  if (scanResult.disposition === "PARTNER_REVIEW") {
    const { data: conv } = await admin
      .from("conversations")
      .select("context")
      .eq("id", conversationId)
      .single();

    await admin
      .from("conversations")
      .update({
        context: {
          ...((conv?.context as Record<string, unknown>) ?? {}),
          ethics_signals: scanResult.signals,
          ethics_disposition: "PARTNER_REVIEW",
        },
      })
      .eq("id", conversationId);
  }

  // -------------------------------------------------------------------
  // Cancel pending drips on inbound reply (existing contacts only)
  // -------------------------------------------------------------------
  if (!isNewLead) {
    await cancelPendingDrips(admin, firmId, leadId, contactId);
  }

  // -------------------------------------------------------------------
  // Generate AI draft reply — channel-agnostic, identical for SMS/email.
  // For new leads we still draft here; the lead.created event handler
  // can also classify in parallel.
  // -------------------------------------------------------------------
  if (!skipDraftReply) {
    await generateDraftReply({
      admin,
      firmId,
      conversationId,
      contactId,
      newMessageContent: body,
      subjectHint,
    });
  }

  // -------------------------------------------------------------------
  // New-lead notifications
  // -------------------------------------------------------------------
  if (isNewLead && leadId) {
    await inngest.send({
      name: "lead.created",
      data: { firmId, leadId },
    });

    await admin.from("approval_queue").insert({
      firm_id: firmId,
      entity_type: "lead",
      entity_id: leadId,
      action_type: "other",
      priority: 5,
      status: "pending",
      metadata: {
        [leadIdentifierColumn]: fromIdentifier,
        text_preview: body.slice(0, 200),
        source: `${source}_inbound_${channel}`,
      },
    });
  }

  return {
    firmId,
    conversationId,
    contactId,
    leadId,
    isNewLead,
    disposition: "ok",
    shortCircuit: false,
    ethicsDisposition: scanResult.disposition,
    ethicsRecommendedAction: scanResult.recommendedAction,
  };
}
