import { describe, it, expect } from "vitest";
import {
  routeLead,
  normalizeState,
  type JurisdictionConfig,
} from "@/lib/leads/jurisdiction-routing";

const config: JurisdictionConfig = {
  supportedStates: ["TX", "IA", "ND", "PA", "NJ"],
  attorneyByState: {
    TX: 'William "Garrison" English, Esq.',
    IA: 'William "Garrison" English, Esq.',
    ND: 'William "Garrison" English, Esq.',
    PA: "Bridget Catherine Sciamanna, Esq.",
    NJ: "Bridget Catherine Sciamanna, Esq.",
  },
  nameToCode: {
    tx: "TX",
    texas: "TX",
    ia: "IA",
    iowa: "IA",
    nd: "ND",
    "north dakota": "ND",
    pa: "PA",
    pennsylvania: "PA",
    nj: "NJ",
    "new jersey": "NJ",
  },
};

describe("normalizeState", () => {
  it("accepts two-letter codes in any case", () => {
    expect(normalizeState("tx", config)).toBe("TX");
    expect(normalizeState("TX", config)).toBe("TX");
    expect(normalizeState("  PA  ", config)).toBe("PA");
  });

  it("accepts full state names case-insensitively", () => {
    expect(normalizeState("Texas", config)).toBe("TX");
    expect(normalizeState("north dakota", config)).toBe("ND");
    expect(normalizeState("PENNSYLVANIA", config)).toBe("PA");
  });

  it("returns null on null/empty input", () => {
    expect(normalizeState(null, config)).toBeNull();
    expect(normalizeState(undefined, config)).toBeNull();
    expect(normalizeState("", config)).toBeNull();
    expect(normalizeState("   ", config)).toBeNull();
  });

  it("returns uppercased input for unrecognized codes (so caller can audit)", () => {
    expect(normalizeState("CA", config)).toBe("CA");
    expect(normalizeState("California", config)).toBe("CALIFORNIA");
  });
});

describe("routeLead", () => {
  it("returns supported + Garrison for TX/IA/ND", () => {
    for (const s of ["TX", "IA", "ND"]) {
      const r = routeLead(s, config);
      expect(r.decision).toBe("supported");
      expect(r.normalizedState).toBe(s);
      expect(r.assignedAttorneyName).toContain("Garrison");
    }
  });

  it("returns supported + Bridget for PA/NJ", () => {
    for (const s of ["PA", "NJ"]) {
      const r = routeLead(s, config);
      expect(r.decision).toBe("supported");
      expect(r.normalizedState).toBe(s);
      expect(r.assignedAttorneyName).toContain("Bridget");
    }
  });

  it("routes by full state name", () => {
    const r = routeLead("Pennsylvania", config);
    expect(r.decision).toBe("supported");
    expect(r.normalizedState).toBe("PA");
    expect(r.assignedAttorneyName).toContain("Bridget");
  });

  it("returns unsupported for served-but-unsupported states", () => {
    const r = routeLead("CA", config);
    expect(r.decision).toBe("unsupported");
    expect(r.normalizedState).toBe("CA");
    expect(r.assignedAttorneyName).toBeNull();
  });

  it("returns unknown for null/empty state", () => {
    for (const input of [null, undefined, "", "   "]) {
      const r = routeLead(input, config);
      expect(r.decision).toBe("unknown");
      expect(r.normalizedState).toBeNull();
      expect(r.assignedAttorneyName).toBeNull();
    }
  });
});
