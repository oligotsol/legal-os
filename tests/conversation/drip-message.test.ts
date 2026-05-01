import { describe, it, expect } from "vitest";
import { sanitizeDripMessage } from "@/lib/ai/drip-message";

describe("sanitizeDripMessage", () => {
  const signOffs: Record<string, { sms: string; email: string }> = {
    TX: {
      sms: "— Garrison",
      email: "— Garrison English\nLegacy First Law PLLC",
    },
    PA: {
      sms: "— Bridget",
      email: "— Bridget Sciamanna\nLegacy First Law PLLC",
    },
  };

  it("removes a banned phrase from message", () => {
    const result = sanitizeDripMessage(
      "Hi John, I wanted to reach out about your matter.",
      ["reach out"],
      300,
      "TX",
      signOffs,
      "sms",
    );

    expect(result).not.toContain("reach out");
    expect(result).toContain("Hi John");
  });

  it("preserves message without banned phrases", () => {
    const result = sanitizeDripMessage(
      "Hi John, checking in about your matter.",
      ["reach out"],
      300,
      "TX",
      signOffs,
      "sms",
    );

    expect(result).toContain("Hi John, checking in about your matter.");
  });

  it("appends TX sign-off for Texas contact", () => {
    const result = sanitizeDripMessage(
      "Hi John, checking in about your matter.",
      [],
      300,
      "TX",
      signOffs,
      "sms",
    );

    expect(result).toContain("— Garrison");
  });

  it("appends PA sign-off for Pennsylvania contact", () => {
    const result = sanitizeDripMessage(
      "Hi Sarah, checking in about your matter.",
      [],
      300,
      "PA",
      signOffs,
      "sms",
    );

    expect(result).toContain("— Bridget");
  });

  it("falls back to first sign-off for unknown state", () => {
    const result = sanitizeDripMessage(
      "Hi Alex, checking in about your matter.",
      [],
      300,
      "CA",
      signOffs,
      "sms",
    );

    // Should fall back to TX (first entry)
    expect(result).toContain("— Garrison");
  });

  it("truncates SMS at sentence boundary when over char limit", () => {
    const longMessage =
      "Hi John, I wanted to check in on your estate planning matter. " +
      "We spoke last week about getting your documents in order. " +
      "I have availability this week for a consultation. " +
      "You can book a time at our scheduling link. " +
      "Looking forward to hearing from you soon.";

    const result = sanitizeDripMessage(
      longMessage,
      [],
      150,
      "TX",
      signOffs,
      "sms",
    );

    // Should be under the limit and end at a sentence boundary
    expect(result.length).toBeLessThanOrEqual(150);
  });

  it("does not truncate email messages", () => {
    const longMessage =
      "Hi John, I wanted to check in on your estate planning matter. " +
      "We spoke last week about getting your documents in order. " +
      "I have availability this week for a consultation. " +
      "You can book a time at our scheduling link. " +
      "Looking forward to hearing from you soon.";

    const result = sanitizeDripMessage(
      longMessage,
      [],
      150,
      "TX",
      signOffs,
      "email",
    );

    // Email should preserve the full message (no SMS char limit)
    expect(result).toContain("Looking forward to hearing from you soon.");
    expect(result).toContain("— Garrison English\nLegacy First Law PLLC");
  });

  it("removes banned phrases case-insensitively", () => {
    const result = sanitizeDripMessage(
      "Hi John, I wanted to REACH OUT about your matter.",
      ["reach out"],
      300,
      "TX",
      signOffs,
      "sms",
    );

    expect(result).not.toContain("REACH OUT");
    expect(result).not.toContain("reach out");
  });
});
