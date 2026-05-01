import { describe, it, expect } from "vitest";
import {
  buildConversationPrompt,
  type ConversationConfig,
  type ConversationContext,
} from "@/lib/ai/prompts/converse";

// --- Test fixtures ---

const baseConfig: ConversationConfig = {
  model: "sonnet",
  maxTokens: 1024,
  temperature: 0.7,
  firmName: "Test Legal Group",
  attorneyName: "Jane Attorney",
  tone: "Professional yet approachable.",
  keyPhrases: ["peace of mind"],
  competitiveAdvantages: ["Fast turnaround"],
  paymentOptions: ["Credit card"],
  turnaround: "72 hours",
  disqualifyRules: [],
  referralRules: [],
  qualifyingQuestions: [],
  objectionScripts: {},
  escalationRules: {
    maxUnansweredMessages: 3,
    escalationDelayHours: 48,
    escalationTarget: "attorney",
  },
  schedulingLink: "https://example.com/schedule",
  bannedPhrases: [
    "Reach out",
    "Touching base",
    "At your earliest convenience",
  ],
  smsCharLimit: 300,
  casualnessLevel: 2,
  perJurisdictionSignOffs: {
    TX: { sms: "— Garrison", email: "— Garrison English\nLegacy First Law PLLC" },
    PA: { sms: "— Bridget", email: "— Bridget Sciamanna\nLegacy First Law PLLC" },
  },
  phoneNumber: "(210) 906-8835",
  firmFullName: "Legacy First Law PLLC",
};

const baseContext: ConversationContext = {
  conversationId: "test-convo",
  phase: "initial_contact",
  channel: "sms",
  contactName: "Jane Doe",
  contactEmail: "jane@example.com",
  contactPhone: "555-0001",
  contactState: "TX",
  matterType: null,
  classificationConfidence: null,
  classificationSignals: null,
  messageCount: 0,
  conversationContext: null,
};

describe("buildConversationPrompt — extended config fields", () => {
  it("includes banned phrases section", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("## Banned Phrases");
    expect(result.system).toContain("Reach out");
    expect(result.system).toContain("Touching base");
    expect(result.system).toContain("At your earliest convenience");
    expect(result.system).toContain("Never use these phrases or close variants");
  });

  it("sign-off lookup works for TX (Garrison)", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("## Sign-Off");
    expect(result.system).toContain("— Garrison");
    expect(result.system).toContain("— Garrison English");
  });

  it("sign-off lookup works for PA (Bridget)", () => {
    const paContext: ConversationContext = { ...baseContext, contactState: "PA" };
    const result = buildConversationPrompt(baseConfig, paContext, [], "Hello");
    expect(result.system).toContain("— Bridget");
    expect(result.system).toContain("— Bridget Sciamanna");
  });

  it("sign-off falls back to first entry for unknown state", () => {
    const unknownContext: ConversationContext = { ...baseContext, contactState: "CA" };
    const result = buildConversationPrompt(baseConfig, unknownContext, [], "Hello");
    // First entry is TX → Garrison
    expect(result.system).toContain("— Garrison");
  });

  it("sign-off falls back to first entry when state is null", () => {
    const nullStateContext: ConversationContext = { ...baseContext, contactState: null };
    const result = buildConversationPrompt(baseConfig, nullStateContext, [], "Hello");
    // First entry is TX → Garrison
    expect(result.system).toContain("— Garrison");
  });

  it("casualness level 1 produces Formal tone in prompt", () => {
    const formalConfig: ConversationConfig = { ...baseConfig, casualnessLevel: 1 };
    const result = buildConversationPrompt(formalConfig, baseContext, [], "Hello");
    expect(result.system).toContain("Formal tone. No contractions.");
  });

  it("casualness level 2 produces Conversational tone in prompt", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("Conversational tone. Contractions OK.");
  });

  it("SMS char limit section appears in prompt", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("## SMS Constraints");
    expect(result.system).toContain("300");
    expect(result.system).toContain("Truncate at sentence boundaries, never mid-word");
  });

  it("phone number appears in Core Rules", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("(210) 906-8835");
    expect(result.system).toContain("Firm phone number: (210) 906-8835. Include in email replies.");
  });

  it("phone number appears in Scheduling section", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("Firm phone: (210) 906-8835");
  });

  it("firmFullName appears in Your Role section", () => {
    const result = buildConversationPrompt(baseConfig, baseContext, [], "Hello");
    expect(result.system).toContain("intake assistant for Legacy First Law PLLC");
  });
});
