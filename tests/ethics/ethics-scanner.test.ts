/**
 * Ethics scanner unit tests.
 *
 * Validates all priority rules, false-positive avoidance,
 * priority ordering, case insensitivity, and signal accumulation.
 */

import { describe, it, expect } from "vitest";
import {
  scanMessage,
  type EthicsScanInput,
  type EthicsScanConfig,
} from "@/lib/ai/ethics-scanner";

const defaultConfig: EthicsScanConfig = {
  activeJurisdictions: ["TX", "IA", "ND", "PA", "NJ"],
  beebeGrandfatherActive: false,
  highValueThreshold: 250000,
};

const baseInput: EthicsScanInput = {
  messageContent: "",
  contactState: "TX",
  estimatedValue: null,
  existingFlags: [],
};

// ---------------------------------------------------------------------------
// Priority 1 — AUTO_DNC
// ---------------------------------------------------------------------------

describe("Priority 1: DNC commands", () => {
  it("returns AUTO_DNC for 'STOP' as entire message", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "STOP" },
      defaultConfig,
    );
    expect(result.disposition).toBe("AUTO_DNC");
    expect(result.recommendedAction).toBe("dnc");
    expect(result.priority).toBe(1);
  });

  it("returns AUTO_DNC for 'unsubscribe' (lowercase)", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "unsubscribe" },
      defaultConfig,
    );
    expect(result.disposition).toBe("AUTO_DNC");
    expect(result.recommendedAction).toBe("dnc");
  });

  it("does NOT trigger DNC for 'I stopped by the store yesterday'", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "I stopped by the store yesterday" },
      defaultConfig,
    );
    expect(result.disposition).toBe("CLEAR");
    expect(result.recommendedAction).toBe("proceed");
  });

  it("returns AUTO_DNC for 'REMOVE ME' (case insensitive)", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "remove me" },
      defaultConfig,
    );
    expect(result.disposition).toBe("AUTO_DNC");
    expect(result.recommendedAction).toBe("dnc");
  });

  it("returns AUTO_DNC for 'STOP' at the beginning of a longer message", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "Stop. I don't want any more messages." },
      defaultConfig,
    );
    expect(result.disposition).toBe("AUTO_DNC");
  });
});

// ---------------------------------------------------------------------------
// Priority 2 — Threat language
// ---------------------------------------------------------------------------

describe("Priority 2: Threat language", () => {
  it("returns STOP_AI for 'I'm going to sue you'", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "I'm going to sue you" },
      defaultConfig,
    );
    expect(result.disposition).toBe("STOP_AI");
    expect(result.recommendedAction).toBe("stop_and_escalate");
    expect(result.priority).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Priority 3 — Crisis language
// ---------------------------------------------------------------------------

describe("Priority 3: Crisis language", () => {
  it("returns STOP_AI for 'I want to die'", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "I want to die" },
      defaultConfig,
    );
    expect(result.disposition).toBe("STOP_AI");
    expect(result.recommendedAction).toBe("stop_and_escalate");
    expect(result.priority).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Priority 4 — High value / already in litigation
// ---------------------------------------------------------------------------

describe("Priority 4: High-value or already in litigation", () => {
  it("returns STOP_AI for estimatedValue > threshold", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I need help with estate planning",
        estimatedValue: 300000,
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("STOP_AI");
    expect(result.recommendedAction).toBe("stop_and_escalate");
    expect(result.priority).toBe(4);
  });

  it("returns STOP_AI for 'already in litigation'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "We are already in litigation over the estate",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("STOP_AI");
    expect(result.recommendedAction).toBe("stop_and_escalate");
    expect(result.priority).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Priority 5 — Litigation/dispute keywords
// ---------------------------------------------------------------------------

describe("Priority 5: Litigation/dispute keywords", () => {
  it("returns HARD_BLOCK + refer_amicus for 'I'm being sued by my neighbor'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I'm being sued by my neighbor",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("refer_amicus");
    expect(result.priority).toBe(5);
    expect(result.matchedPatterns).toContain("being sued");
  });
});

// ---------------------------------------------------------------------------
// Priority 6 — Trademark (with Beebe exception)
// ---------------------------------------------------------------------------

describe("Priority 6: Trademark", () => {
  it("returns HARD_BLOCK + refer_thaler for 'I need a trademark for my business'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I need a trademark for my business",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("refer_thaler");
    expect(result.priority).toBe(6);
  });

  it("skips trademark block when beebeGrandfatherActive AND message contains 'beebe'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "I need a trademark for the Beebe family estate business",
      },
      { ...defaultConfig, beebeGrandfatherActive: true },
    );
    // Should NOT be refer_thaler; should fall through to CLEAR (or later rule)
    expect(result.recommendedAction).not.toBe("refer_thaler");
  });

  it("does NOT skip trademark block when beebeGrandfatherActive is false even with 'beebe'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "I need a trademark for the Beebe family estate business",
      },
      { ...defaultConfig, beebeGrandfatherActive: false },
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("refer_thaler");
  });
});

// ---------------------------------------------------------------------------
// Priority 7 — Out of state (UPL)
// ---------------------------------------------------------------------------

describe("Priority 7: Out-of-state UPL block", () => {
  it("returns HARD_BLOCK + upl_block for contactState='CA'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I need help with my estate plan",
        contactState: "CA",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("upl_block");
    expect(result.priority).toBe(7);
  });

  it("does NOT trigger UPL block for contactState=null", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I need help with my estate plan",
        contactState: null,
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("CLEAR");
  });

  it("does NOT trigger UPL block for an active jurisdiction", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I need help with my estate plan",
        contactState: "TX",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("CLEAR");
  });
});

// ---------------------------------------------------------------------------
// Priority 8 — Attorney-as-fiduciary (RPC 1.8(c))
// ---------------------------------------------------------------------------

describe("Priority 8: Attorney-as-fiduciary", () => {
  it("returns HARD_BLOCK + rpc_1_8c_block when fiduciary keyword + target present", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "Can you be my personal representative? I want you to handle everything.",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("rpc_1_8c_block");
    expect(result.priority).toBe(8);
  });

  it("does NOT trigger fiduciary block without a target reference", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "My sister will be the personal representative of the estate",
      },
      defaultConfig,
    );
    expect(result.recommendedAction).not.toBe("rpc_1_8c_block");
  });
});

// ---------------------------------------------------------------------------
// Priority 9 — Diminished capacity (RPC 1.14)
// ---------------------------------------------------------------------------

describe("Priority 9: Diminished capacity", () => {
  it("returns HARD_BLOCK + rpc_1_14_block for capacity + relational combo", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "My mother has dementia and I need a guardian for my parent",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("rpc_1_14_block");
    expect(result.priority).toBe(9);
  });

  it("does NOT trigger capacity block without relational indicator", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I have been diagnosed with dementia",
      },
      defaultConfig,
    );
    expect(result.recommendedAction).not.toBe("rpc_1_14_block");
  });
});

// ---------------------------------------------------------------------------
// Priority 10 — Conflict of interest (RPC 1.7)
// ---------------------------------------------------------------------------

describe("Priority 10: Conflict of interest", () => {
  it("returns HARD_BLOCK + rpc_1_7_block for 'The other side already has a lawyer'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "The other side already has a lawyer",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("rpc_1_7_block");
    expect(result.priority).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Priority 11 — Criminal intent
// ---------------------------------------------------------------------------

describe("Priority 11: Criminal intent", () => {
  it("returns HARD_BLOCK + criminal_block for 'I want to hide money from the IRS'", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "I want to hide money from the IRS",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("HARD_BLOCK");
    expect(result.recommendedAction).toBe("criminal_block");
    expect(result.priority).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Priority 12 — Partner review signals
// ---------------------------------------------------------------------------

describe("Priority 12: Partner review signals", () => {
  it("returns PARTNER_REVIEW with 2+ signals for combined message", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "We're a blended family and I have an existing counsel already",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("PARTNER_REVIEW");
    expect(result.recommendedAction).toBe("escalate");
    expect(result.priority).toBe(12);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    expect(result.signals).toContain("blended family");
    expect(result.signals).toContain("existing counsel");
  });

  it("accumulates all matching signals, not just the first", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "We're a blended family with a stepchild, I have an existing counsel, and we own out of state property in multiple states",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("PARTNER_REVIEW");
    expect(result.signals.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Priority 13 — CLEAR
// ---------------------------------------------------------------------------

describe("Priority 13: Clear", () => {
  it("returns CLEAR for a plain message", () => {
    const result = scanMessage(
      { ...baseInput, messageContent: "I need help with my will" },
      defaultConfig,
    );
    expect(result.disposition).toBe("CLEAR");
    expect(result.recommendedAction).toBe("proceed");
    expect(result.priority).toBe(13);
    expect(result.matchedPatterns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe("Priority ordering", () => {
  it("DNC (priority 1) wins over threat language (priority 2)", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent: "STOP. I'm going to sue you for this.",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("AUTO_DNC");
    expect(result.priority).toBe(1);
  });

  it("threat language (priority 2) wins over litigation keywords (priority 5)", () => {
    const result = scanMessage(
      {
        ...baseInput,
        messageContent:
          "I'm going to sue you over this lawsuit you mishandled",
      },
      defaultConfig,
    );
    expect(result.disposition).toBe("STOP_AI");
    expect(result.priority).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Case insensitivity
// ---------------------------------------------------------------------------

describe("Case insensitivity", () => {
  it("'REMOVE ME' works the same as 'remove me'", () => {
    const upper = scanMessage(
      { ...baseInput, messageContent: "REMOVE ME" },
      defaultConfig,
    );
    const lower = scanMessage(
      { ...baseInput, messageContent: "remove me" },
      defaultConfig,
    );
    expect(upper.disposition).toBe("AUTO_DNC");
    expect(lower.disposition).toBe("AUTO_DNC");
    expect(upper.recommendedAction).toBe(lower.recommendedAction);
  });

  it("'MALPRACTICE' triggers threat detection same as 'malpractice'", () => {
    const upper = scanMessage(
      { ...baseInput, messageContent: "This is MALPRACTICE" },
      defaultConfig,
    );
    const lower = scanMessage(
      { ...baseInput, messageContent: "This is malpractice" },
      defaultConfig,
    );
    expect(upper.disposition).toBe("STOP_AI");
    expect(lower.disposition).toBe("STOP_AI");
  });
});
