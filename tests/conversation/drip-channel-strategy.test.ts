import { describe, it, expect } from "vitest";
import { pickDripChannel } from "@/lib/inngest/functions/drip-worker";

describe("pickDripChannel", () => {
  describe("match_origin (default)", () => {
    it("locks to conversation channel even when AI suggests otherwise", () => {
      expect(
        pickDripChannel({
          strategy: "match_origin",
          aiSuggestion: "email",
          conversationChannel: "sms",
          hasPhone: true,
          hasEmail: true,
        }),
      ).toBe("sms");

      expect(
        pickDripChannel({
          strategy: "match_origin",
          aiSuggestion: "sms",
          conversationChannel: "email",
          hasPhone: true,
          hasEmail: true,
        }),
      ).toBe("email");
    });

    it("falls back to the available channel when the origin channel is missing", () => {
      expect(
        pickDripChannel({
          strategy: "match_origin",
          aiSuggestion: "email",
          conversationChannel: "sms",
          hasPhone: false,
          hasEmail: true,
        }),
      ).toBe("email");
    });
  });

  describe("ai_choice", () => {
    it("respects whatever the AI picked", () => {
      expect(
        pickDripChannel({
          strategy: "ai_choice",
          aiSuggestion: "email",
          conversationChannel: "sms",
          hasPhone: true,
          hasEmail: true,
        }),
      ).toBe("email");
    });
  });

  describe("prefer_email / prefer_sms", () => {
    it("prefers the configured channel when available", () => {
      expect(
        pickDripChannel({
          strategy: "prefer_email",
          aiSuggestion: "sms",
          conversationChannel: "sms",
          hasPhone: true,
          hasEmail: true,
        }),
      ).toBe("email");

      expect(
        pickDripChannel({
          strategy: "prefer_sms",
          aiSuggestion: "email",
          conversationChannel: "email",
          hasPhone: true,
          hasEmail: true,
        }),
      ).toBe("sms");
    });

    it("falls back when the preferred channel is missing", () => {
      expect(
        pickDripChannel({
          strategy: "prefer_email",
          aiSuggestion: "sms",
          conversationChannel: "sms",
          hasPhone: true,
          hasEmail: false,
        }),
      ).toBe("sms");

      expect(
        pickDripChannel({
          strategy: "prefer_sms",
          aiSuggestion: "email",
          conversationChannel: "email",
          hasPhone: false,
          hasEmail: true,
        }),
      ).toBe("email");
    });
  });
});
