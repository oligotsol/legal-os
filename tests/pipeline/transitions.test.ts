import { describe, it, expect } from "vitest";
import {
  validateTransition,
  type TransitionRequest,
  type GateContext,
} from "@/lib/pipeline/transitions";
import type { PipelineStage } from "@/types/database";

// ---------------------------------------------------------------------------
// Mock stage builder
// ---------------------------------------------------------------------------

const TERMINAL_IDS = ["stage-13", "stage-14", "stage-15", "stage-16"];

function makeStage(
  overrides: Partial<PipelineStage> &
    Pick<PipelineStage, "id" | "slug" | "name" | "display_order" | "stage_type" | "is_terminal" | "allowed_transitions">,
): PipelineStage {
  return {
    firm_id: "firm-1",
    description: null,
    sla_hours: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function mockStages(): PipelineStage[] {
  return [
    makeStage({
      id: "stage-01",
      slug: "new_lead",
      name: "New Lead",
      stage_type: "intake",
      display_order: 1,
      sla_hours: 2,
      is_terminal: false,
      allowed_transitions: ["stage-02", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-02",
      slug: "first_touch",
      name: "First Touch",
      stage_type: "intake",
      display_order: 2,
      is_terminal: false,
      allowed_transitions: ["stage-03", "stage-04", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-03",
      slug: "awaiting_reply",
      name: "Awaiting Reply",
      stage_type: "qualification",
      display_order: 3,
      sla_hours: 72,
      is_terminal: false,
      allowed_transitions: ["stage-04", "stage-02", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-04",
      slug: "in_conversation",
      name: "In Conversation",
      stage_type: "qualification",
      display_order: 4,
      sla_hours: 24,
      is_terminal: false,
      allowed_transitions: ["stage-05", "stage-03", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-05",
      slug: "fee_quoted",
      name: "Fee Quoted",
      stage_type: "negotiation",
      display_order: 5,
      sla_hours: 72,
      is_terminal: false,
      allowed_transitions: ["stage-06", "stage-07", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-06",
      slug: "negotiating",
      name: "Negotiating",
      stage_type: "negotiation",
      display_order: 6,
      sla_hours: 48,
      is_terminal: false,
      allowed_transitions: ["stage-05", "stage-07", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-07",
      slug: "engagement_sent",
      name: "Engagement Sent",
      stage_type: "closing",
      display_order: 7,
      sla_hours: 72,
      is_terminal: false,
      allowed_transitions: ["stage-08", "stage-06", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-08",
      slug: "engagement_signed",
      name: "Engagement Signed",
      stage_type: "closing",
      display_order: 8,
      sla_hours: 24,
      is_terminal: false,
      allowed_transitions: ["stage-09", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-09",
      slug: "payment_pending",
      name: "Payment Pending",
      stage_type: "closing",
      display_order: 9,
      sla_hours: 120,
      is_terminal: false,
      allowed_transitions: ["stage-10", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-10",
      slug: "paid_awaiting_intake",
      name: "Paid \u2014 Awaiting Intake",
      stage_type: "post_close",
      display_order: 10,
      sla_hours: 72,
      is_terminal: false,
      allowed_transitions: ["stage-11", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-11",
      slug: "intake_complete",
      name: "Intake Complete",
      stage_type: "post_close",
      display_order: 11,
      is_terminal: false,
      allowed_transitions: ["stage-12", ...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-12",
      slug: "consulted",
      name: "Consulted",
      stage_type: "post_close",
      display_order: 12,
      is_terminal: false,
      allowed_transitions: [...TERMINAL_IDS],
    }),
    makeStage({
      id: "stage-13",
      slug: "referred_amicus_lex",
      name: "Referred \u2014 Amicus Lex",
      stage_type: "terminal",
      display_order: 13,
      is_terminal: true,
      allowed_transitions: [],
    }),
    makeStage({
      id: "stage-14",
      slug: "referred_thaler",
      name: "Referred \u2014 Thaler",
      stage_type: "terminal",
      display_order: 14,
      is_terminal: true,
      allowed_transitions: [],
    }),
    makeStage({
      id: "stage-15",
      slug: "do_not_contact",
      name: "Do Not Contact",
      stage_type: "terminal",
      display_order: 15,
      is_terminal: true,
      allowed_transitions: [],
    }),
    makeStage({
      id: "stage-16",
      slug: "lost_no_response",
      name: "Lost \u2014 No Response",
      stage_type: "terminal",
      display_order: 16,
      is_terminal: true,
      allowed_transitions: [],
    }),
  ];
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<TransitionRequest> = {}): TransitionRequest {
  return {
    matterId: "matter-1",
    fromStageId: "stage-01",
    toStageId: "stage-02",
    actorId: "user-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateTransition", () => {
  const stages = mockStages();

  it("allows valid forward transition: new_lead -> first_touch", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-01", toStageId: "stage-02" }),
      stages,
    );
    expect(result).toEqual({ valid: true });
  });

  it("allows valid skip transition: first_touch -> in_conversation", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-02", toStageId: "stage-04" }),
      stages,
    );
    expect(result).toEqual({ valid: true });
  });

  it("rejects transition FROM a terminal stage", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-13", toStageId: "stage-01" }),
      stages,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("terminal stage");
    expect(result.error).toContain("referred_amicus_lex");
  });

  it("rejects invalid transition: new_lead -> payment_pending", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-01", toStageId: "stage-09" }),
      stages,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("allows initial assignment (fromStageId=null)", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: null, toStageId: "stage-01" }),
      stages,
    );
    expect(result).toEqual({ valid: true });
  });

  it("rejects fee_quoted when ethics scan is not clean", () => {
    const gate: GateContext = { ethicsScanClean: false };
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-04", toStageId: "stage-05" }),
      stages,
      gate,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ethics scan");
  });

  it("rejects engagement_sent when jurisdiction is not locked", () => {
    const gate: GateContext = { jurisdictionLocked: false };
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-05", toStageId: "stage-07" }),
      stages,
      gate,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("jurisdiction not locked");
  });

  it("rejects paid_awaiting_intake when Dropbox Sign not confirmed", () => {
    const gate: GateContext = { dropboxSignConfirmed: false };
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-09", toStageId: "stage-10" }),
      stages,
      gate,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Dropbox Sign");
  });

  it("allows any non-terminal -> referred_amicus_lex (terminal exit)", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-04", toStageId: "stage-13" }),
      stages,
    );
    expect(result).toEqual({ valid: true });
  });

  it("allows engagement_signed -> payment_pending (forward only)", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-08", toStageId: "stage-09" }),
      stages,
    );
    expect(result).toEqual({ valid: true });
  });

  it("rejects engagement_signed -> engagement_sent (no regression)", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-08", toStageId: "stage-07" }),
      stages,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("returns error when target stage does not exist", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-01", toStageId: "nonexistent" }),
      stages,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Target stage not found");
  });

  it("returns error when source stage does not exist", () => {
    const result = validateTransition(
      makeRequest({ fromStageId: "nonexistent", toStageId: "stage-02" }),
      stages,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Source stage not found");
  });

  it("allows gate checks to pass when gate context is undefined (not checked)", () => {
    // fee_quoted transition without gate context — should pass
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-04", toStageId: "stage-05" }),
      stages,
    );
    expect(result).toEqual({ valid: true });
  });

  it("allows gate checks to pass when gate value is true", () => {
    const gate: GateContext = { ethicsScanClean: true };
    const result = validateTransition(
      makeRequest({ fromStageId: "stage-04", toStageId: "stage-05" }),
      stages,
      gate,
    );
    expect(result).toEqual({ valid: true });
  });
});
