/**
 * Tests for lead → matter conversion.
 *
 * Mocks Supabase client to test business logic without a live database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { convertLeadToMatter, type ConvertLeadInput } from "@/lib/pipeline/convert-lead";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockAdmin() {
  const rpcMock = vi.fn().mockResolvedValue({ error: null });

  const chains: Record<string, ReturnType<typeof createChain>> = {};

  function createChain(tableName: string) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};

    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    return chain;
  }

  const from = vi.fn((tableName: string) => {
    if (!chains[tableName]) {
      chains[tableName] = createChain(tableName);
    }
    return chains[tableName];
  });

  return { from, rpc: rpcMock, _chains: chains };
}

const baseInput: ConvertLeadInput = {
  firmId: "firm_1",
  leadId: "lead_1",
  contactId: "contact_1",
  matterType: "estate_planning",
  jurisdiction: "TX",
  summary: "Simple will",
  actorId: "user_1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("convertLeadToMatter", () => {
  let admin: ReturnType<typeof createMockAdmin>;

  beforeEach(() => {
    vi.restoreAllMocks();
    admin = createMockAdmin();
  });

  it("creates matter, stage history, updates lead, and returns IDs", async () => {
    // Setup pipeline_stages
    const stagesChain = admin._chains["pipeline_stages"] ?? admin.from("pipeline_stages");
    stagesChain.single.mockResolvedValueOnce({
      data: { id: "stage_new_lead" },
      error: null,
    });

    // Setup leads (status check)
    const leadsChain = admin._chains["leads"] ?? admin.from("leads");
    leadsChain.single.mockResolvedValueOnce({
      data: { status: "qualified" },
      error: null,
    });

    // Setup matters insert
    const mattersChain = admin._chains["matters"] ?? admin.from("matters");
    mattersChain.single.mockResolvedValueOnce({
      data: { id: "matter_1" },
      error: null,
    });

    // Setup matter_stage_history insert
    const historyChain = admin._chains["matter_stage_history"] ?? admin.from("matter_stage_history");
    historyChain.insert.mockReturnValue({ error: null });

    // Setup lead update
    leadsChain.eq.mockReturnValue(leadsChain);

    const result = await convertLeadToMatter(admin as never, baseInput);

    expect(result.matterId).toBe("matter_1");
    expect(result.stageId).toBe("stage_new_lead");
  });

  it("throws when lead is already converted", async () => {
    const stagesChain = admin._chains["pipeline_stages"] ?? admin.from("pipeline_stages");
    stagesChain.single.mockResolvedValueOnce({
      data: { id: "stage_new_lead" },
      error: null,
    });

    const leadsChain = admin._chains["leads"] ?? admin.from("leads");
    leadsChain.single.mockResolvedValueOnce({
      data: { status: "converted" },
      error: null,
    });

    await expect(
      convertLeadToMatter(admin as never, baseInput),
    ).rejects.toThrow("already been converted");
  });

  it("throws when new_lead pipeline stage not found", async () => {
    const stagesChain = admin._chains["pipeline_stages"] ?? admin.from("pipeline_stages");
    stagesChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });

    await expect(
      convertLeadToMatter(admin as never, baseInput),
    ).rejects.toThrow("new_lead");
  });

  it("uses classification matter_type when input matterType is null", async () => {
    const inputWithoutType = { ...baseInput, matterType: null };

    const stagesChain = admin._chains["pipeline_stages"] ?? admin.from("pipeline_stages");
    stagesChain.single.mockResolvedValueOnce({
      data: { id: "stage_new_lead" },
      error: null,
    });

    // Classifications lookup
    const classChain = admin._chains["classifications"] ?? admin.from("classifications");
    classChain.maybeSingle.mockResolvedValueOnce({
      data: { matter_type: "probate" },
      error: null,
    });

    const leadsChain = admin._chains["leads"] ?? admin.from("leads");
    leadsChain.single.mockResolvedValueOnce({
      data: { status: "qualified" },
      error: null,
    });

    const mattersChain = admin._chains["matters"] ?? admin.from("matters");
    mattersChain.single.mockResolvedValueOnce({
      data: { id: "matter_2" },
      error: null,
    });

    const historyChain = admin._chains["matter_stage_history"] ?? admin.from("matter_stage_history");
    historyChain.insert.mockReturnValue({ error: null });

    const result = await convertLeadToMatter(admin as never, inputWithoutType);

    expect(result.matterId).toBe("matter_2");

    // Verify matter insert was called (verify through rpc audit log call)
    expect(admin.rpc).toHaveBeenCalledWith(
      "insert_audit_log",
      expect.objectContaining({
        p_action: "lead.converted_to_matter",
        p_after: expect.objectContaining({ matter_type: "probate" }),
      }),
    );
  });

  it("throws when lead is not found", async () => {
    const stagesChain = admin._chains["pipeline_stages"] ?? admin.from("pipeline_stages");
    stagesChain.single.mockResolvedValueOnce({
      data: { id: "stage_new_lead" },
      error: null,
    });

    const leadsChain = admin._chains["leads"] ?? admin.from("leads");
    leadsChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });

    await expect(
      convertLeadToMatter(admin as never, baseInput),
    ).rejects.toThrow("Lead not found");
  });
});
