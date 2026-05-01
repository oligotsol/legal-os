/**
 * Integration credentials helper tests.
 *
 * Mocks the Supabase admin client.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the admin client before importing the module under test
const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: mockEq }) });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

import {
  getIntegrationAccount,
  IntegrationCredentialsError,
} from "@/lib/integrations/credentials";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getIntegrationAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the chain for each test
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: mockEq }),
    });
  });

  it("returns account and isActive=true for active integration", async () => {
    const fakeAccount = {
      id: "int_1",
      firm_id: "firm_1",
      provider: "dialpad",
      credentials: { apiKey: "test_key" },
      status: "active",
      last_sync_at: null,
      config: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    mockSingle.mockResolvedValueOnce({ data: fakeAccount, error: null });

    const result = await getIntegrationAccount("firm_1", "dialpad");

    expect(result.account).toEqual(fakeAccount);
    expect(result.isActive).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("integration_accounts");
  });

  it("throws IntegrationCredentialsError when not found", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "No rows returned", code: "PGRST116" },
    });

    try {
      await getIntegrationAccount("firm_1", "postmark");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IntegrationCredentialsError);
      const credErr = err as IntegrationCredentialsError;
      expect(credErr.provider).toBe("postmark");
      expect(credErr.firmId).toBe("firm_1");
    }
  });

  it("returns isActive=false for inactive integration", async () => {
    const inactiveAccount = {
      id: "int_2",
      firm_id: "firm_1",
      provider: "postmark",
      credentials: { serverToken: "old_token" },
      status: "inactive",
      last_sync_at: null,
      config: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    mockSingle.mockResolvedValueOnce({ data: inactiveAccount, error: null });

    const result = await getIntegrationAccount("firm_1", "postmark");

    expect(result.account).toEqual(inactiveAccount);
    expect(result.isActive).toBe(false);
  });
});
