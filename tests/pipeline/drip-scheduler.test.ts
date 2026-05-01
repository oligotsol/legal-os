import { describe, it, expect, vi } from "vitest";
import { scheduleDripSequence } from "@/lib/pipeline/drip-scheduler";

// Mock the admin client's .from().insert().select() chain
function createMockAdmin(insertResult: { data: any[]; error: null }) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue(insertResult),
      }),
    }),
  } as any;
}

describe("scheduleDripSequence", () => {
  it("creates 4 scheduled_actions with correct day offsets", async () => {
    const mockIds = [
      { id: "action-1" },
      { id: "action-2" },
      { id: "action-3" },
      { id: "action-4" },
    ];

    const admin = createMockAdmin({ data: mockIds, error: null });

    const result = await scheduleDripSequence(
      admin,
      "firm-1",
      "lead-1",
      "contact-1",
      "convo-1",
      "campaign-1",
    );

    expect(result.scheduledCount).toBe(4);
    expect(result.actionIds).toEqual([
      "action-1",
      "action-2",
      "action-3",
      "action-4",
    ]);

    // Verify insert was called with 4 actions
    const fromCall = admin.from.mock.calls[0];
    expect(fromCall[0]).toBe("scheduled_actions");

    const insertCall = admin.from().insert.mock.calls[0];
    const actions = insertCall[0];
    expect(actions).toHaveLength(4);

    // Verify day offsets
    const dayOffsets = actions.map(
      (a: any) => a.metadata.drip_day,
    );
    expect(dayOffsets).toEqual([2, 5, 7, 10]);
  });

  it("each action has correct metadata", async () => {
    const mockIds = [
      { id: "a1" },
      { id: "a2" },
      { id: "a3" },
      { id: "a4" },
    ];

    const admin = createMockAdmin({ data: mockIds, error: null });

    await scheduleDripSequence(
      admin,
      "firm-1",
      "lead-1",
      "contact-1",
      "convo-1",
      "campaign-1",
    );

    const insertCall = admin.from().insert.mock.calls[0];
    const actions = insertCall[0];

    for (const action of actions) {
      expect(action.metadata.type).toBe("ai_drip");
      expect(action.metadata.conversation_id).toBe("convo-1");
      expect(action.status).toBe("pending");
      expect(action.firm_id).toBe("firm-1");
      expect(action.lead_id).toBe("lead-1");
      expect(action.contact_id).toBe("contact-1");
      expect(action.campaign_id).toBe("campaign-1");
      expect(action.template_id).toBeNull();
    }
  });

  it("all actions have pending status", async () => {
    const mockIds = [
      { id: "a1" },
      { id: "a2" },
      { id: "a3" },
      { id: "a4" },
    ];

    const admin = createMockAdmin({ data: mockIds, error: null });

    await scheduleDripSequence(
      admin,
      "firm-1",
      "lead-1",
      "contact-1",
      "convo-1",
      null,
    );

    const insertCall = admin.from().insert.mock.calls[0];
    const actions = insertCall[0];

    for (const action of actions) {
      expect(action.status).toBe("pending");
    }
  });

  it("throws on insert error", async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "insert failed" },
          }),
        }),
      }),
    } as any;

    await expect(
      scheduleDripSequence(
        admin,
        "firm-1",
        "lead-1",
        "contact-1",
        "convo-1",
        null,
      ),
    ).rejects.toThrow("Failed to schedule drip sequence: insert failed");
  });
});
