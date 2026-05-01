import { describe, it, expect, vi } from "vitest";
import { cancelPendingDrips } from "@/lib/pipeline/cancel-on-reply";

function createMockAdmin(selectResult: { data: any[]; error: null }) {
  return {
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue(selectResult),
            }),
          }),
        }),
      }),
    }),
  } as any;
}

describe("cancelPendingDrips", () => {
  it("returns count of cancelled actions", async () => {
    const admin = createMockAdmin({
      data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
      error: null,
    });

    const count = await cancelPendingDrips(
      admin,
      "firm-1",
      "lead-1",
      "contact-1",
    );

    expect(count).toBe(3);
  });

  it("returns 0 when no pending actions", async () => {
    const admin = createMockAdmin({ data: [], error: null });

    const count = await cancelPendingDrips(
      admin,
      "firm-1",
      "lead-1",
      "contact-1",
    );

    expect(count).toBe(0);
  });

  it("handles errors gracefully and returns 0", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const admin = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "db error" },
                }),
              }),
            }),
          }),
        }),
      }),
    } as any;

    const count = await cancelPendingDrips(
      admin,
      "firm-1",
      null,
      "contact-1",
    );

    expect(count).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to cancel pending drips:",
      "db error",
    );

    consoleSpy.mockRestore();
  });
});
