import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildClassificationPrompt } from "@/lib/ai/prompts/classify";
import type { ClassificationConfig, ClassificationInput } from "@/lib/ai/prompts/classify";
import { computeTokenCostCents, resolveModelId } from "@/lib/ai/utils";

// --- Mock Anthropic SDK ---

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// --- Test fixtures ---

const config: ClassificationConfig = {
  matterTypes: [
    "estate_planning",
    "business_transactional",
    "trademark",
  ],
  confidenceThreshold: 0.7,
};

const input: ClassificationInput = {
  leadSource: "website",
  leadPayload: {
    message: "I need help setting up a living trust for my family.",
    service_interest: "trust",
  },
  contactName: "John Doe",
  contactEmail: "john@example.com",
  contactPhone: "555-123-4567",
};

// --- Prompt builder tests ---

describe("buildClassificationPrompt", () => {
  it("produces a valid prompt string", () => {
    const prompt = buildClassificationPrompt(config, input);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes all matter types", () => {
    const prompt = buildClassificationPrompt(config, input);

    expect(prompt).toContain("estate_planning");
    expect(prompt).toContain("business_transactional");
    expect(prompt).toContain("trademark");
  });

  it("includes lead source and payload", () => {
    const prompt = buildClassificationPrompt(config, input);

    expect(prompt).toContain("website");
    expect(prompt).toContain("living trust");
  });

  it("includes contact information when provided", () => {
    const prompt = buildClassificationPrompt(config, input);

    expect(prompt).toContain("John Doe");
    expect(prompt).toContain("john@example.com");
    expect(prompt).toContain("555-123-4567");
  });

  it("works without optional contact fields", () => {
    const minimalInput: ClassificationInput = {
      leadSource: "legalmatch",
      leadPayload: { type: "will" },
    };

    const prompt = buildClassificationPrompt(config, minimalInput);

    expect(prompt).toContain("legalmatch");
    expect(prompt).not.toContain("Contact Information");
  });

  it("includes confidence threshold", () => {
    const prompt = buildClassificationPrompt(config, input);
    expect(prompt).toContain("0.7");
  });

  it("requests JSON response format", () => {
    const prompt = buildClassificationPrompt(config, input);
    expect(prompt).toContain("matter_type");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("signals");
    expect(prompt).toContain("valid JSON");
  });
});

// --- classifyLead tests (mocked SDK) ---

describe("classifyLead", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("parses structured JSON response correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            matter_type: "estate_planning",
            confidence: 0.92,
            signals: {
              primary_indicator: "Mentioned living trust",
              supporting_factors: ["Family estate planning context"],
              concerns: [],
            },
          }),
        },
      ],
      usage: { input_tokens: 500, output_tokens: 100 },
    });

    // Import after mock is set up
    const { classifyLead } = await import("@/lib/ai/classify");

    const result = await classifyLead(config, input, "haiku");

    expect(result.matterType).toBe("estate_planning");
    expect(result.confidence).toBe(0.92);
    expect(result.signals).toHaveProperty("primary_indicator");
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(100);
    expect(result.costCents).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("claude-haiku-4-5-20251001");
  });

  it("handles malformed API response gracefully", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not valid json at all" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { classifyLead } = await import("@/lib/ai/classify");

    await expect(classifyLead(config, input)).rejects.toThrow(
      "Failed to parse classification response as JSON",
    );
  });

  it("handles missing fields in parsed response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ matter_type: "estate_planning" }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { classifyLead } = await import("@/lib/ai/classify");

    await expect(classifyLead(config, input)).rejects.toThrow(
      "Invalid classification response: missing matter_type or confidence",
    );
  });

  it("handles API errors", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Rate limited"));

    const { classifyLead } = await import("@/lib/ai/classify");

    await expect(classifyLead(config, input)).rejects.toThrow(
      "Anthropic API call failed: Rate limited",
    );
  });

  it("handles empty content array", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 100, output_tokens: 0 },
    });

    const { classifyLead } = await import("@/lib/ai/classify");

    await expect(classifyLead(config, input)).rejects.toThrow(
      "No text content in API response",
    );
  });
});

// --- Utils tests ---

describe("computeTokenCostCents", () => {
  it("computes Haiku costs correctly", () => {
    // 1000 input tokens at $0.80/1M = $0.0008 USD = 0.08 cents
    // 500 output tokens at $4.00/1M = $0.002 USD = 0.2 cents
    // Total = 0.28 cents
    const cost = computeTokenCostCents(
      "claude-haiku-4-5-20251001",
      1000,
      500,
    );
    expect(cost).toBeCloseTo(0.28, 2);
  });

  it("computes Sonnet costs correctly", () => {
    // 1000 input at $3/1M = 0.3 cents
    // 1000 output at $15/1M = 1.5 cents
    // Total = 1.8 cents... wait let me recalculate
    // 1000 input at $3/1M = $0.003 = 0.3 cents
    // 1000 output at $15/1M = $0.015 = 1.5 cents
    // Total = $0.018 = 1.8 cents... no
    // computeTokenCostCents returns cents:
    // inputCost = (1000/1M) * 3 = 0.003 USD
    // outputCost = (1000/1M) * 15 = 0.015 USD
    // total USD = 0.018
    // cents = 0.018 * 100 = 1.8
    const cost = computeTokenCostCents(
      "claude-sonnet-4-6-20250514",
      1000,
      1000,
    );
    expect(cost).toBeCloseTo(1.8, 2);
  });

  it("returns 0 for unknown model with warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cost = computeTokenCostCents("unknown-model", 1000, 1000);
    expect(cost).toBe(0);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("handles zero tokens", () => {
    const cost = computeTokenCostCents("claude-haiku-4-5-20251001", 0, 0);
    expect(cost).toBe(0);
  });
});

describe("resolveModelId", () => {
  it("resolves 'haiku' alias", () => {
    expect(resolveModelId("haiku")).toBe("claude-haiku-4-5-20251001");
  });

  it("resolves 'sonnet' alias", () => {
    expect(resolveModelId("sonnet")).toBe("claude-sonnet-4-6-20250514");
  });

  it("resolves 'opus' alias", () => {
    expect(resolveModelId("opus")).toBe("claude-opus-4-6-20250610");
  });

  it("passes through full model IDs unchanged", () => {
    expect(resolveModelId("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5-20251001",
    );
  });
});
