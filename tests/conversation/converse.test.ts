import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildConversationPrompt,
  buildPhaseInstructions,
  mapMessagesToTurns,
  type ConversationConfig,
  type ConversationContext,
  type PromptMessage,
} from "@/lib/ai/prompts/converse";
import type { ConversationPhase } from "@/types/database";

// --- Mock Anthropic SDK ---

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// --- Test fixtures ---

const config: ConversationConfig = {
  model: "sonnet",
  maxTokens: 1024,
  temperature: 0.7,
  firmName: "Test Legal Group",
  attorneyName: "Jane Attorney",
  tone: "Professional yet approachable. Use clear language.",
  keyPhrases: ["peace of mind", "protect your family"],
  competitiveAdvantages: ["50 years combined experience", "Flat-fee pricing"],
  paymentOptions: ["Credit card", "Payment plan available"],
  turnaround: "Most matters completed within 2-3 weeks",
  disqualifyRules: ["Active litigation against our firm"],
  referralRules: ["Criminal defense matters"],
  qualifyingQuestions: [
    "What brings you to us today?",
    "What state do you reside in?",
    "What is your marital status?",
  ],
  objectionScripts: {
    "too expensive": "Our flat-fee pricing means no surprises. Let me walk you through what's included.",
    "need to think about it": "Of course! What specific concerns can I address to help you decide?",
  },
  escalationRules: {
    maxUnansweredMessages: 3,
    escalationDelayHours: 48,
    escalationTarget: "attorney",
  },
  schedulingLink: "https://calendly.com/test-legal/consultation",
  bannedPhrases: [],
  smsCharLimit: 300,
  casualnessLevel: 2,
  perJurisdictionSignOffs: {},
  phoneNumber: "",
  firmFullName: "Test Legal Group",
};

const context: ConversationContext = {
  conversationId: "conv-123",
  phase: "qualification",
  channel: "sms",
  contactName: "John Smith",
  contactEmail: "john@example.com",
  contactPhone: "555-123-4567",
  contactState: "TX",
  matterType: "estate_planning",
  classificationConfidence: 0.92,
  classificationSignals: { primary: "trust mention" },
  messageCount: 3,
  conversationContext: { referral_source: "website" },
};

const sampleHistory: PromptMessage[] = [
  {
    direction: "inbound",
    senderType: "contact",
    content: "Hi, I need help with a trust.",
    channel: "sms",
  },
  {
    direction: "outbound",
    senderType: "ai",
    content: "Hello! Thanks for reaching out. What state do you reside in?",
    channel: "sms",
  },
];

const validApiResponse = {
  reply: "Thank you, John. Could you tell me about your marital status?",
  suggested_channel: "sms",
  phase_recommendation: "stay",
  escalation_signal: false,
  reasoning: "Client in qualification, need more info.",
};

// --- buildConversationPrompt tests ---

describe("buildConversationPrompt", () => {
  it("produces a non-empty system prompt", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "I live in Texas.");
    expect(result.system).toBeTruthy();
    expect(result.system.length).toBeGreaterThan(100);
  });

  it("contains firm name and attorney name", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("Test Legal Group");
    expect(result.system).toContain("Jane Attorney");
  });

  it("contains tone from config", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("Professional yet approachable");
  });

  it("contains current phase", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("QUALIFICATION");
  });

  it("contains contact name and state", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("John Smith");
    expect(result.system).toContain("TX");
  });

  it("contains matter type from classification", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("estate_planning");
  });

  it("has no hardcoded vertical strings in core prompt logic", () => {
    // Use a config with generic values — the prompt builder itself should
    // not inject "estate planning", "wills", or "trusts"
    const genericConfig: ConversationConfig = {
      ...config,
      firmName: "Generic Firm",
      keyPhrases: ["quality service"],
      competitiveAdvantages: ["fast turnaround"],
      qualifyingQuestions: ["What do you need help with?"],
      objectionScripts: {},
    };
    const genericContext: ConversationContext = {
      ...context,
      matterType: null,
      classificationSignals: null,
      conversationContext: null,
    };

    const result = buildConversationPrompt(genericConfig, genericContext, [], "Hello");
    const systemLower = result.system.toLowerCase();

    expect(systemLower).not.toContain("estate planning");
    expect(systemLower).not.toContain("wills");
    expect(systemLower).not.toContain("trusts");
  });

  it("includes qualifying questions in qualification phase", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("What brings you to us today?");
    expect(result.system).toContain("What state do you reside in?");
    expect(result.system).toContain("Qualifying Questions");
  });

  it("excludes objection scripts in qualification phase", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).not.toContain("Objection Handling Scripts");
  });

  it("includes objection scripts in negotiation phase", () => {
    const negotiationContext: ConversationContext = { ...context, phase: "negotiation" };
    const result = buildConversationPrompt(config, negotiationContext, sampleHistory, "Hello");
    expect(result.system).toContain("Objection Handling Scripts");
    expect(result.system).toContain("too expensive");
  });

  it("includes scheduling link", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("https://calendly.com/test-legal/consultation");
  });

  it("includes JSON response format instructions", () => {
    const result = buildConversationPrompt(config, context, sampleHistory, "Hello");
    expect(result.system).toContain("valid JSON");
    expect(result.system).toContain("reply");
    expect(result.system).toContain("suggested_channel");
    expect(result.system).toContain("phase_recommendation");
    expect(result.system).toContain("escalation_signal");
    expect(result.system).toContain("reasoning");
  });
});

// --- mapMessagesToTurns tests ---

describe("mapMessagesToTurns", () => {
  it("maps inbound→user, outbound→assistant", () => {
    const turns = mapMessagesToTurns(sampleHistory, "New message");
    expect(turns[0].role).toBe("user");
    expect(turns[1].role).toBe("assistant");
  });

  it("appends newMessage as final user turn", () => {
    const turns = mapMessagesToTurns(sampleHistory, "I live in Texas.");
    const lastTurn = turns[turns.length - 1];
    expect(lastTurn.role).toBe("user");
    expect(lastTurn.content).toContain("I live in Texas.");
  });

  it("concatenates adjacent same-role messages", () => {
    const history: PromptMessage[] = [
      { direction: "inbound", senderType: "contact", content: "Hello", channel: "sms" },
      { direction: "inbound", senderType: "contact", content: "I need help", channel: "sms" },
      { direction: "outbound", senderType: "ai", content: "Hi there!", channel: "sms" },
    ];

    const turns = mapMessagesToTurns(history, "Thanks");
    // First two inbound should merge into one user turn
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("Hello");
    expect(turns[0].content).toContain("I need help");
    expect(turns[1].role).toBe("assistant");
  });

  it("handles empty history (single user turn)", () => {
    const turns = mapMessagesToTurns([], "First message");
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("First message");
  });

  it("prepends synthetic opener when history starts with outbound", () => {
    const history: PromptMessage[] = [
      { direction: "outbound", senderType: "ai", content: "Welcome!", channel: "sms" },
    ];

    const turns = mapMessagesToTurns(history, "Thanks");
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("[Client inquiry received]");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toBe("Welcome!");
  });
});

// --- buildPhaseInstructions tests ---

describe("buildPhaseInstructions", () => {
  const allPhases: ConversationPhase[] = [
    "initial_contact",
    "qualification",
    "scheduling",
    "follow_up",
    "negotiation",
    "closing",
  ];

  it("returns non-empty string for each phase", () => {
    for (const phase of allPhases) {
      const instructions = buildPhaseInstructions(phase);
      expect(instructions).toBeTruthy();
      expect(instructions.length).toBeGreaterThan(20);
    }
  });

  it("different phases produce different instructions", () => {
    const seen = new Set<string>();
    for (const phase of allPhases) {
      const instructions = buildPhaseInstructions(phase);
      expect(seen.has(instructions)).toBe(false);
      seen.add(instructions);
    }
  });
});

// --- converse() SDK caller tests ---

describe("converse", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("parses valid JSON response with all fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(validApiResponse) }],
      usage: { input_tokens: 1500, output_tokens: 200 },
    });

    const { converse } = await import("@/lib/ai/converse");
    const result = await converse(config, context, sampleHistory, "I live in Texas.");

    expect(result.response.reply).toBe(validApiResponse.reply);
    expect(result.response.suggested_channel).toBe("sms");
    expect(result.response.phase_recommendation).toBe("stay");
    expect(result.response.escalation_signal).toBe(false);
    expect(result.response.reasoning).toBeTruthy();
  });

  it("populates observability fields correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(validApiResponse) }],
      usage: { input_tokens: 1500, output_tokens: 200 },
    });

    const { converse } = await import("@/lib/ai/converse");
    const result = await converse(config, context, sampleHistory, "Hello");

    expect(result.inputTokens).toBe(1500);
    expect(result.outputTokens).toBe(200);
    expect(result.costCents).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("claude-sonnet-4-6-20250514");
  });

  it("uses system parameter (not embedded in messages)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(validApiResponse) }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    });

    const { converse } = await import("@/lib/ai/converse");
    await converse(config, context, sampleHistory, "Hello");

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBeTruthy();
    expect(typeof callArgs.system).toBe("string");
    // System should not appear embedded in the messages array
    for (const msg of callArgs.messages) {
      expect(msg.content).not.toContain("## Your Role");
    }
  });

  it("passes multi-turn messages to SDK", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(validApiResponse) }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    });

    const { converse } = await import("@/lib/ai/converse");
    await converse(config, context, sampleHistory, "I live in Texas.");

    const callArgs = mockCreate.mock.calls[0][0];
    // sampleHistory has 2 messages + newMessage = 3 turns
    expect(callArgs.messages.length).toBeGreaterThanOrEqual(2);

    // Verify alternating roles
    for (let i = 1; i < callArgs.messages.length; i++) {
      expect(callArgs.messages[i].role).not.toBe(callArgs.messages[i - 1].role);
    }
  });

  it("respects modelOverride parameter", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(validApiResponse) }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    });

    const { converse } = await import("@/lib/ai/converse");
    const result = await converse(config, context, sampleHistory, "Hello", "opus");

    expect(result.model).toBe("claude-opus-4-6-20250610");
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-opus-4-6-20250610");
  });

  it("handles API error → ConversationError", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Rate limited"));

    const { converse, ConversationError } = await import("@/lib/ai/converse");

    const err = await converse(config, context, sampleHistory, "Hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConversationError);
    expect((err as Error).message).toContain("Anthropic API call failed: Rate limited");
  });

  it("handles malformed JSON → ConversationError", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "This is not JSON" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { converse } = await import("@/lib/ai/converse");

    await expect(converse(config, context, sampleHistory, "Hello")).rejects.toThrow(
      "Failed to parse conversation response as JSON",
    );
  });

  it("handles Zod validation failure → ConversationError", async () => {
    const invalidResponse = {
      reply: "",  // min(1) fails
      suggested_channel: "fax",  // not in enum
      phase_recommendation: "stay",
      escalation_signal: false,
      reasoning: "test",
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(invalidResponse) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { converse } = await import("@/lib/ai/converse");

    await expect(converse(config, context, sampleHistory, "Hello")).rejects.toThrow(
      "Response validation failed",
    );
  });
});
