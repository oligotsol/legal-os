import { describe, it, expect, vi, afterEach } from "vitest";
import { computeSlaColor } from "@/lib/pipeline/transitions";

// ---------------------------------------------------------------------------
// Helper: create a stageEnteredAt value N hours ago from a fixed "now"
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-04-27T12:00:00Z").getTime();

function hoursAgo(hours: number): string {
  return new Date(FIXED_NOW - hours * 60 * 60 * 1000).toISOString();
}

describe("computeSlaColor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function withFixedTime(fn: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    fn();
  }

  it("returns NONE when slaHours is null", () => {
    withFixedTime(() => {
      expect(computeSlaColor(hoursAgo(10), null)).toBe("NONE");
    });
  });

  it("returns GREEN at 0% elapsed", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 0 hours elapsed
      expect(computeSlaColor(hoursAgo(0), 10)).toBe("GREEN");
    });
  });

  it("returns GREEN at 30% elapsed", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 3 hours elapsed = 30%
      expect(computeSlaColor(hoursAgo(3), 10)).toBe("GREEN");
    });
  });

  it("returns YELLOW at 50% elapsed (boundary: >= 0.5)", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 5 hours elapsed = 50%
      expect(computeSlaColor(hoursAgo(5), 10)).toBe("YELLOW");
    });
  });

  it("returns ORANGE at 75% elapsed", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 7.5 hours elapsed = 75%
      expect(computeSlaColor(hoursAgo(7.5), 10)).toBe("ORANGE");
    });
  });

  it("returns RED at 100% elapsed", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 10 hours elapsed = 100%
      expect(computeSlaColor(hoursAgo(10), 10)).toBe("RED");
    });
  });

  it("returns CRITICAL at 150% elapsed", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 15 hours elapsed = 150%
      expect(computeSlaColor(hoursAgo(15), 10)).toBe("CRITICAL");
    });
  });

  it("returns YELLOW at exactly 50% (boundary test)", () => {
    withFixedTime(() => {
      // SLA is 2 hours, 1 hour elapsed = exactly 50%
      expect(computeSlaColor(hoursAgo(1), 2)).toBe("YELLOW");
    });
  });

  it("returns GREEN just under 50%", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 4.9 hours elapsed = 49%
      expect(computeSlaColor(hoursAgo(4.9), 10)).toBe("GREEN");
    });
  });

  it("accepts Date object as stageEnteredAt", () => {
    withFixedTime(() => {
      const entered = new Date(FIXED_NOW - 5 * 60 * 60 * 1000); // 5 hours ago
      expect(computeSlaColor(entered, 10)).toBe("YELLOW");
    });
  });

  it("returns RED at 120% elapsed (between RED and CRITICAL)", () => {
    withFixedTime(() => {
      // SLA is 10 hours, 12 hours elapsed = 120%
      expect(computeSlaColor(hoursAgo(12), 10)).toBe("RED");
    });
  });
});
