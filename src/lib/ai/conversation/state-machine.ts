/**
 * Conversation state machine — pure functions for phase transitions.
 *
 * Validates AI-recommended phase changes against the allowed transition
 * graph, computes new conversation state, and handles escalation.
 *
 * Does NOT read or write to DB — caller handles persistence.
 */

import type {
  Conversation,
  ConversationPhase,
  ConversationStatus,
} from "@/types/database";
import type { ConverseResponse } from "../converse";

// ---------------------------------------------------------------------------
// Phase transition graph
// ---------------------------------------------------------------------------

const ALL_PHASES: ConversationPhase[] = [
  "initial_contact",
  "qualification",
  "scheduling",
  "follow_up",
  "negotiation",
  "closing",
];

/**
 * Allowed phase transitions. Each key maps to the phases it may advance to.
 * `follow_up` is reachable from every phase (client goes quiet).
 * Backward transitions are intentionally allowed (re-engagement, re-qualify).
 */
export const PHASE_TRANSITIONS: Record<ConversationPhase, ConversationPhase[]> =
  {
    initial_contact: ["qualification", "scheduling", "follow_up"],
    qualification: ["scheduling", "follow_up", "negotiation"],
    scheduling: ["follow_up", "qualification", "negotiation"],
    follow_up: [
      "initial_contact",
      "qualification",
      "scheduling",
      "negotiation",
    ],
    negotiation: ["closing", "follow_up"],
    closing: ["negotiation", "follow_up"],
  };

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

const PHASE_SET = new Set<string>(ALL_PHASES);

export function isValidPhase(phase: string): phase is ConversationPhase {
  return PHASE_SET.has(phase);
}

// ---------------------------------------------------------------------------
// Transition types
// ---------------------------------------------------------------------------

export interface TransitionInput {
  conversation: Pick<
    Conversation,
    "status" | "phase" | "context" | "message_count"
  >;
  converseResponse: ConverseResponse;
}

export interface TransitionResult {
  phase: ConversationPhase;
  status: ConversationStatus;
  context: Record<string, unknown>;
  phaseChanged: boolean;
  escalated: boolean;
  escalationReason: string | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export function computeTransition(input: TransitionInput): TransitionResult {
  const { conversation, converseResponse } = input;
  const currentPhase = conversation.phase;
  const currentStatus = conversation.status;
  const currentContext: Record<string, unknown> = conversation.context ?? {};
  const warnings: string[] = [];

  // Helper: build result preserving current state
  const unchanged = (
    extra?: Partial<TransitionResult>,
  ): TransitionResult => ({
    phase: currentPhase,
    status: currentStatus,
    context: mergeContext(currentContext, converseResponse.reasoning),
    phaseChanged: false,
    escalated: false,
    escalationReason: null,
    warnings,
    ...extra,
  });

  // 1. Terminal states — no transitions allowed
  if (currentStatus === "closed" || currentStatus === "escalated") {
    warnings.push(
      `Conversation is ${currentStatus}; transition ignored`,
    );
    return unchanged();
  }

  // 2. Escalation signal overrides everything
  if (converseResponse.escalation_signal) {
    return {
      phase: currentPhase,
      status: "escalated",
      context: mergeContext(currentContext, converseResponse.reasoning),
      phaseChanged: false,
      escalated: true,
      escalationReason:
        converseResponse.escalation_reason ?? "escalation_signal received",
      warnings,
    };
  }

  const rec = converseResponse.phase_recommendation;

  // 3. Stay
  if (rec === "stay") {
    return unchanged();
  }

  // 4. Escalate
  if (rec === "escalate") {
    return {
      phase: currentPhase,
      status: "escalated",
      context: mergeContext(currentContext, converseResponse.reasoning),
      phaseChanged: false,
      escalated: true,
      escalationReason:
        converseResponse.escalation_reason ?? "phase_recommendation is escalate",
      warnings,
    };
  }

  // 5. Advance
  const nextPhase = converseResponse.next_phase;

  // 5a. Missing next_phase
  if (!nextPhase) {
    warnings.push(
      'phase_recommendation is "advance" but next_phase is missing',
    );
    return unchanged();
  }

  // 5b. Invalid phase string
  if (!isValidPhase(nextPhase)) {
    warnings.push(
      `AI suggested invalid phase "${nextPhase}"`,
    );
    return unchanged();
  }

  // 5c. Disallowed transition
  const allowed = PHASE_TRANSITIONS[currentPhase];
  if (!allowed.includes(nextPhase)) {
    warnings.push(
      `Transition from "${currentPhase}" to "${nextPhase}" is not allowed`,
    );
    return unchanged();
  }

  // 5d. Valid transition
  return {
    phase: nextPhase,
    status: currentStatus,
    context: mergeContext(currentContext, converseResponse.reasoning),
    phaseChanged: true,
    escalated: false,
    escalationReason: null,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeContext(
  existing: Record<string, unknown>,
  reasoning: string,
): Record<string, unknown> {
  return {
    ...existing,
    last_ai_reasoning: reasoning,
  };
}
