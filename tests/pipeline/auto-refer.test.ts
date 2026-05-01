import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeAutoRefer,
  type AutoReferInput,
} from "@/lib/pipeline/auto-refer";

// ---------------------------------------------------------------------------
// Mock cancelPendingDrips
// ---------------------------------------------------------------------------

vi.mock("@/lib/pipeline/cancel-on-reply", () => ({
  cancelPendingDrips: vi.fn().mockResolvedValue(3),
}));

// ---------------------------------------------------------------------------
// Mock Supabase admin client
// ---------------------------------------------------------------------------

/**
 * Creates a mock admin client that tracks inserts/updates and returns
 * configurable data for select queries.
 */
function createTrackingMockAdmin() {
  const inserts: Array<{ table: string; data: unknown }> = [];
  const updates: Array<{ table: string; data: unknown }> = [];

  const mock: Record<string, unknown> = {
    _inserts: inserts,
    _updates: updates,
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data:
                table === "pipeline_stages"
                  ? { id: "stage-terminal-id" }
                  : { stage_id: "stage-old-id" },
              error: null,
            }),
            single: vi.fn().mockResolvedValue({
              data:
                table === "pipeline_stages"
                  ? { id: "stage-terminal-id" }
                  : { stage_id: "stage-old-id" },
              error: null,
            }),
          }),
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              table === "pipeline_stages"
                ? { id: "stage-terminal-id" }
                : { stage_id: "stage-old-id" },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockImplementation((data: unknown) => {
        updates.push({ table, data });
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }),
      insert: vi.fn().mockImplementation((data: unknown) => {
        inserts.push({ table, data });
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: `new-${table}-id` },
              error: null,
            }),
          }),
        };
      }),
    })),
  };

  return mock;
}

// ---------------------------------------------------------------------------
// Base input
// ---------------------------------------------------------------------------

const baseInput: AutoReferInput = {
  firmId: "firm-001",
  target: "amicus_lex",
  matterId: "matter-001",
  conversationId: "convo-001",
  contactId: "contact-001",
  leadId: "lead-001",
  contactName: "Jane Doe",
  contactEmail: "jane@example.com",
  contactPhone: "555-0001",
  contactState: "TX",
  matchedRule: "Litigation keyword detected",
  matchedPatterns: ["being sued"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeAutoRefer", () => {
  let admin: ReturnType<typeof createTrackingMockAdmin>;

  beforeEach(() => {
    vi.clearAllMocks();
    admin = createTrackingMockAdmin();
  });

  it("returns success on valid amicus referral", async () => {
    const result = await executeAutoRefer(admin as any, baseInput);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("creates referral message with RPC 7.2(b) disclosure for amicus", async () => {
    await executeAutoRefer(admin as any, baseInput);

    const msgInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "messages",
    );
    expect(msgInsert).toBeDefined();
    expect(msgInsert!.data.content).toContain("RPC 7.2(b)");
    expect(msgInsert!.data.content).toContain("Amicus Lex");
    expect(msgInsert!.data.content).toContain(
      "independently owned and operated",
    );
    expect(msgInsert!.data.content).toContain("Hi Jane Doe,");
    expect(msgInsert!.data.direction).toBe("outbound");
    expect(msgInsert!.data.status).toBe("pending_approval");
    expect(msgInsert!.data.ai_generated).toBe(true);
  });

  it("creates referral message without RPC disclosure for thaler", async () => {
    const input: AutoReferInput = {
      ...baseInput,
      target: "thaler",
      matchedRule: "Trademark matter detected",
      matchedPatterns: ["trademark"],
    };

    await executeAutoRefer(admin as any, input);

    const msgInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "messages",
    );
    expect(msgInsert).toBeDefined();
    expect(msgInsert!.data.content).toContain("Thaler Law");
    expect(msgInsert!.data.content).toContain("trademark prosecution");
    expect(msgInsert!.data.content).not.toContain("RPC 7.2(b)");
  });

  it("closes the conversation", async () => {
    const result = await executeAutoRefer(admin as any, baseInput);

    expect(result.conversationClosed).toBe(true);
    const convoUpdate = (admin._updates as Array<{ table: string; data: any }>).find(
      (u) => u.table === "conversations",
    );
    expect(convoUpdate).toBeDefined();
    expect(convoUpdate!.data.status).toBe("closed");
  });

  it("cancels pending drips and reports count", async () => {
    const result = await executeAutoRefer(admin as any, baseInput);

    expect(result.dripsCancelled).toBe(3);
  });

  it("creates approval queue item with priority 10", async () => {
    const result = await executeAutoRefer(admin as any, baseInput);

    expect(result.approvalQueueId).toBe("new-approval_queue-id");
    const queueInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "approval_queue",
    );
    expect(queueInsert).toBeDefined();
    expect(queueInsert!.data.priority).toBe(10);
    expect(queueInsert!.data.status).toBe("pending");
    expect(queueInsert!.data.entity_type).toBe("message");
    expect(queueInsert!.data.action_type).toBe("message");
    expect(queueInsert!.data.metadata.referral_target).toBe("amicus_lex");
    expect(queueInsert!.data.metadata.source).toBe("auto_refer");
  });

  it("creates audit log entry with correct action", async () => {
    await executeAutoRefer(admin as any, baseInput);

    const auditInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "audit_log",
    );
    expect(auditInsert).toBeDefined();
    expect(auditInsert!.data.action).toBe(
      "pipeline.auto_referred.amicus_lex",
    );
    expect(auditInsert!.data.entity_type).toBe("conversation");
    expect(auditInsert!.data.entity_id).toBe("convo-001");
    expect(auditInsert!.data.after.target).toBe("amicus_lex");
    expect(auditInsert!.data.after.matched_rule).toBe(
      "Litigation keyword detected",
    );
  });

  it("creates audit log with thaler action for thaler target", async () => {
    const input: AutoReferInput = {
      ...baseInput,
      target: "thaler",
    };

    await executeAutoRefer(admin as any, input);

    const auditInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "audit_log",
    );
    expect(auditInsert!.data.action).toBe("pipeline.auto_referred.thaler");
  });

  it("transitions matter when matterId is provided", async () => {
    const result = await executeAutoRefer(admin as any, baseInput);

    expect(result.stageTransitioned).toBe(true);

    // Should update matter
    const matterUpdate = (admin._updates as Array<{ table: string; data: any }>).find(
      (u) => u.table === "matters",
    );
    expect(matterUpdate).toBeDefined();
    expect(matterUpdate!.data.stage_id).toBe("stage-terminal-id");
    expect(matterUpdate!.data.status).toBe("closed_lost");

    // Should insert stage history
    const historyInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "matter_stage_history",
    );
    expect(historyInsert).toBeDefined();
    expect(historyInsert!.data.from_stage_id).toBe("stage-old-id");
    expect(historyInsert!.data.to_stage_id).toBe("stage-terminal-id");
    expect(historyInsert!.data.reason).toContain("Auto-referred to amicus_lex");
  });

  it("works without matterId — skips stage transition", async () => {
    const input: AutoReferInput = {
      ...baseInput,
      matterId: null,
    };

    const result = await executeAutoRefer(admin as any, input);

    expect(result.success).toBe(true);
    expect(result.stageTransitioned).toBe(false);
    expect(result.conversationClosed).toBe(true);
    expect(result.messageId).toBe("new-messages-id");
    expect(result.approvalQueueId).toBe("new-approval_queue-id");
    expect(result.dripsCancelled).toBe(3);

    // No matter update or history insert
    const matterUpdate = (admin._updates as Array<{ table: string; data: any }>).find(
      (u) => u.table === "matters",
    );
    expect(matterUpdate).toBeUndefined();

    const historyInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "matter_stage_history",
    );
    expect(historyInsert).toBeUndefined();
  });

  it("uses email channel when contact has email", async () => {
    await executeAutoRefer(admin as any, baseInput);

    const msgInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "messages",
    );
    expect(msgInsert!.data.channel).toBe("email");
  });

  it("uses sms channel when contact has no email", async () => {
    const input: AutoReferInput = {
      ...baseInput,
      contactEmail: null,
    };

    await executeAutoRefer(admin as any, input);

    const msgInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "messages",
    );
    expect(msgInsert!.data.channel).toBe("sms");
  });

  it("stores referral metadata on the message", async () => {
    await executeAutoRefer(admin as any, baseInput);

    const msgInsert = (admin._inserts as Array<{ table: string; data: any }>).find(
      (i) => i.table === "messages",
    );
    expect(msgInsert!.data.metadata).toEqual({
      source: "auto_refer",
      referral_target: "amicus_lex",
      matched_rule: "Litigation keyword detected",
    });
  });

  it("returns error message when an exception is thrown", async () => {
    // Create admin that throws on conversation update
    const failingAdmin = {
      from: vi.fn().mockImplementation(() => {
        throw new Error("DB connection lost");
      }),
    };

    const result = await executeAutoRefer(failingAdmin as any, baseInput);

    expect(result.success).toBe(false);
    expect(result.error).toBe("DB connection lost");
  });
});
