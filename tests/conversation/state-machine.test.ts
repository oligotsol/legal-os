import { describe, it, expect } from "vitest";
import {
  computeTransition,
  isValidPhase,
  PHASE_TRANSITIONS,
  type TransitionInput,
} from "@/lib/ai/conversation/state-machine";
import type {
  Conversation,
  ConversationPhase,
  ConversationStatus,
} from "@/types/database";
import type { ConverseResponse } from "@/lib/ai/converse";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeConversation = (
  overrides?: Partial<
    Pick<Conversation, "status" | "phase" | "context" | "message_count">
  >,
): Pick<Conversation, "status" | "phase" | "context" | "message_count"> => ({
  status: "active",
  phase: "initial_contact",
  context: { existing: "data" },
  message_count: 3,
  ...overrides,
});

const makeResponse = (
  overrides?: Partial<ConverseResponse>,
): ConverseResponse => ({
  reply: "Hello there!",
  suggested_channel: "sms",
  phase_recommendation: "stay",
  escalation_signal: false,
  reasoning: "Client seems engaged",
  ...overrides,
});

const makeInput = (
  convOverrides?: Partial<
    Pick<Conversation, "status" | "phase" | "context" | "message_count">
  >,
  respOverrides?: Partial<ConverseResponse>,
): TransitionInput => ({
  conversation: makeConversation(convOverrides),
  converseResponse: makeResponse(respOverrides),
});

// ---------------------------------------------------------------------------
// computeTransition
// ---------------------------------------------------------------------------

describe("computeTransition", () => {
  it('"stay" recommendation keeps phase unchanged', () => {
    const result = computeTransition(
      makeInput({ phase: "qualification" }, { phase_recommendation: "stay" }),
    );

    expect(result.phase).toBe("qualification");
    expect(result.phaseChanged).toBe(false);
    expect(result.escalated).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('"advance" with valid next_phase transitions', () => {
    const result = computeTransition(
      makeInput(
        { phase: "initial_contact" },
        { phase_recommendation: "advance", next_phase: "qualification" },
      ),
    );

    expect(result.phase).toBe("qualification");
    expect(result.phaseChanged).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.status).toBe("active");
  });

  it('"advance" with invalid phase string stays and warns', () => {
    const result = computeTransition(
      makeInput(
        { phase: "initial_contact" },
        { phase_recommendation: "advance", next_phase: "nonexistent_phase" },
      ),
    );

    expect(result.phase).toBe("initial_contact");
    expect(result.phaseChanged).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("invalid phase"),
    );
  });

  it('"advance" with disallowed transition stays and warns', () => {
    // initial_contact cannot go directly to closing
    const result = computeTransition(
      makeInput(
        { phase: "initial_contact" },
        { phase_recommendation: "advance", next_phase: "closing" },
      ),
    );

    expect(result.phase).toBe("initial_contact");
    expect(result.phaseChanged).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("not allowed"),
    );
  });

  it('"advance" without next_phase stays and warns', () => {
    const result = computeTransition(
      makeInput(
        { phase: "initial_contact" },
        { phase_recommendation: "advance" },
      ),
    );

    expect(result.phase).toBe("initial_contact");
    expect(result.phaseChanged).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("next_phase is missing"),
    );
  });

  it('"escalate" recommendation sets status to escalated', () => {
    const result = computeTransition(
      makeInput(
        { phase: "qualification" },
        {
          phase_recommendation: "escalate",
          escalation_reason: "Client is angry",
        },
      ),
    );

    expect(result.status).toBe("escalated");
    expect(result.escalated).toBe(true);
    expect(result.escalationReason).toBe("Client is angry");
    expect(result.phase).toBe("qualification");
    expect(result.phaseChanged).toBe(false);
  });

  it("escalation_signal=true overrides phase_recommendation", () => {
    const result = computeTransition(
      makeInput(
        { phase: "initial_contact" },
        {
          phase_recommendation: "advance",
          next_phase: "qualification",
          escalation_signal: true,
          escalation_reason: "Threatening language detected",
        },
      ),
    );

    expect(result.status).toBe("escalated");
    expect(result.escalated).toBe(true);
    expect(result.escalationReason).toBe("Threatening language detected");
    expect(result.phase).toBe("initial_contact");
    expect(result.phaseChanged).toBe(false);
  });

  it("closed conversation returns unchanged with warning", () => {
    const result = computeTransition(
      makeInput(
        { status: "closed", phase: "closing" },
        { phase_recommendation: "advance", next_phase: "negotiation" },
      ),
    );

    expect(result.phase).toBe("closing");
    expect(result.status).toBe("closed");
    expect(result.phaseChanged).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("closed"),
    );
  });

  it("escalated conversation returns unchanged with warning", () => {
    const result = computeTransition(
      makeInput(
        { status: "escalated", phase: "qualification" },
        { phase_recommendation: "stay" },
      ),
    );

    expect(result.phase).toBe("qualification");
    expect(result.status).toBe("escalated");
    expect(result.warnings).toContainEqual(
      expect.stringContaining("escalated"),
    );
  });

  it("merges reasoning into context", () => {
    const result = computeTransition(
      makeInput(
        { context: { foo: "bar" } },
        { reasoning: "AI reasoning here" },
      ),
    );

    expect(result.context).toEqual({
      foo: "bar",
      last_ai_reasoning: "AI reasoning here",
    });
  });

  it("phaseChanged is true only when phase actually changes", () => {
    const stay = computeTransition(
      makeInput({}, { phase_recommendation: "stay" }),
    );
    expect(stay.phaseChanged).toBe(false);

    const advance = computeTransition(
      makeInput(
        { phase: "initial_contact" },
        { phase_recommendation: "advance", next_phase: "qualification" },
      ),
    );
    expect(advance.phaseChanged).toBe(true);
  });

  it("escalated flag matches status change", () => {
    const notEscalated = computeTransition(
      makeInput({}, { phase_recommendation: "stay" }),
    );
    expect(notEscalated.escalated).toBe(false);
    expect(notEscalated.status).toBe("active");

    const escalated = computeTransition(
      makeInput({}, { phase_recommendation: "escalate" }),
    );
    expect(escalated.escalated).toBe(true);
    expect(escalated.status).toBe("escalated");
  });

  it("escalation without explicit reason uses default", () => {
    const result = computeTransition(
      makeInput({}, { phase_recommendation: "escalate" }),
    );

    expect(result.escalationReason).toBeTruthy();
  });

  it("handles null context on conversation", () => {
    const result = computeTransition(
      makeInput(
        { context: null },
        { phase_recommendation: "stay", reasoning: "some reasoning" },
      ),
    );

    expect(result.context).toEqual({
      last_ai_reasoning: "some reasoning",
    });
  });
});

// ---------------------------------------------------------------------------
// isValidPhase
// ---------------------------------------------------------------------------

describe("isValidPhase", () => {
  const validPhases: ConversationPhase[] = [
    "initial_contact",
    "qualification",
    "scheduling",
    "follow_up",
    "negotiation",
    "closing",
  ];

  it.each(validPhases)('returns true for valid phase "%s"', (phase) => {
    expect(isValidPhase(phase)).toBe(true);
  });

  it("returns false for invalid string", () => {
    expect(isValidPhase("nonexistent")).toBe(false);
    expect(isValidPhase("")).toBe(false);
    expect(isValidPhase("INITIAL_CONTACT")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PHASE_TRANSITIONS graph properties
// ---------------------------------------------------------------------------

describe("PHASE_TRANSITIONS", () => {
  const phases = Object.keys(PHASE_TRANSITIONS) as ConversationPhase[];

  it("each phase has at least one allowed transition", () => {
    for (const phase of phases) {
      expect(PHASE_TRANSITIONS[phase].length).toBeGreaterThan(0);
    }
  });

  it("no phase allows transition to itself", () => {
    for (const phase of phases) {
      expect(PHASE_TRANSITIONS[phase]).not.toContain(phase);
    }
  });

  it("follow_up is reachable from all other phases", () => {
    for (const phase of phases) {
      if (phase === "follow_up") continue; // can't transition to itself
      expect(PHASE_TRANSITIONS[phase]).toContain("follow_up");
    }
  });
});
