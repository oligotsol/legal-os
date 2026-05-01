/**
 * Classification worker — Inngest event-driven function that auto-classifies
 * new leads using AI.
 *
 * Triggered by "lead.created" event. Loads firm classification config,
 * calls ai.classify(), stores result in classifications + ai_jobs tables.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyLead } from "@/lib/ai/classify";

export const classifyLeadWorker = inngest.createFunction(
  {
    id: "classify-lead",
    retries: 2,
    triggers: [{ event: "lead.created" }],
  },
  async ({ event, step }: { event: { data: { firmId: string; leadId: string } }; step: any }) => {
    const { firmId, leadId } = event.data;

    const admin = createAdminClient();

    // Step 1: Load lead + contact data
    const lead = await step.run("fetch-lead", async () => {
      const { data, error } = await admin
        .from("leads")
        .select("*, contacts(full_name, email, phone)")
        .eq("id", leadId)
        .eq("firm_id", firmId)
        .single();

      if (error || !data) {
        throw new Error(`Lead not found: ${error?.message ?? "no data"}`);
      }
      return data;
    });

    // Step 2: Load classification config
    const config = await step.run("fetch-config", async () => {
      const { data } = await admin
        .from("firm_config")
        .select("value")
        .eq("firm_id", firmId)
        .eq("key", "classification_config")
        .maybeSingle();

      const value = (data?.value ?? {}) as Record<string, unknown>;
      return {
        matterTypes: (value.matter_types as string[]) ?? [
          "estate_planning",
          "business_transactional",
          "trademark",
        ],
        confidenceThreshold: (value.confidence_threshold as number) ?? 0.7,
        model: (value.model as string) ?? "haiku",
      };
    });

    // Step 3: Classify
    const result = await step.run("classify", async () => {
      const contactRaw = lead.contacts as unknown;
      const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
        full_name: string;
        email: string | null;
        phone: string | null;
      } | null;

      return classifyLead(
        {
          matterTypes: config.matterTypes,
          confidenceThreshold: config.confidenceThreshold,
        },
        {
          leadSource: lead.source,
          leadPayload: (lead.payload as Record<string, unknown>) ?? {},
          contactName: contact?.full_name ?? lead.full_name ?? undefined,
          contactEmail: contact?.email ?? lead.email ?? undefined,
          contactPhone: contact?.phone ?? lead.phone ?? undefined,
        },
        config.model,
      );
    });

    // Step 4: Store classification + AI job
    await step.run("store-results", async () => {
      // Mark any existing classifications as not current
      await admin
        .from("classifications")
        .update({ is_current: false })
        .eq("lead_id", leadId)
        .eq("firm_id", firmId);

      // Insert new classification
      const { data: classification } = await admin
        .from("classifications")
        .insert({
          firm_id: firmId,
          lead_id: leadId,
          matter_type: result.matterType,
          confidence: result.confidence,
          signals: result.signals,
          model: result.model,
          is_current: true,
        })
        .select("id")
        .single();

      // Insert AI job
      await admin.from("ai_jobs").insert({
        firm_id: firmId,
        model: result.model,
        purpose: "classify",
        entity_type: "lead",
        entity_id: leadId,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_cents: result.costCents,
        latency_ms: result.latencyMs,
        status: "completed",
        request_metadata: { lead_source: lead.source },
        response_metadata: {
          matter_type: result.matterType,
          confidence: result.confidence,
        },
        privileged: false,
      });

      // Update lead status if confidence meets threshold
      if (result.confidence >= config.confidenceThreshold) {
        await admin
          .from("leads")
          .update({ status: "qualified" })
          .eq("id", leadId)
          .eq("firm_id", firmId);
      }

      return { classificationId: classification?.id };
    });

    return {
      leadId,
      matterType: result.matterType,
      confidence: result.confidence,
    };
  },
);
