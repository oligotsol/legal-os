/**
 * Tests for engagement letter generation.
 *
 * Mocks Supabase client to test variable assembly and validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateEngagementLetter,
  type GenerateLetterInput,
} from "@/lib/engagement/generate-letter";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockAdmin(overrides?: {
  matter?: Record<string, unknown>;
  feeQuote?: Record<string, unknown>;
  jurisdiction?: Record<string, unknown>;
  firm?: Record<string, unknown>;
}) {
  const rpcMock = vi.fn().mockResolvedValue({ error: null });

  const defaults = {
    matter: {
      id: "matter_1",
      matter_type: "estate_planning",
      jurisdiction: "TX",
      contact_id: "contact_1",
      contacts: {
        full_name: "Jane Smith",
        email: "jane@example.com",
        state: "TX",
      },
    },
    feeQuote: {
      id: "fq_1",
      total_quoted_fee: 2500,
      line_items: [
        { service_name: "Simple Will", subtotal: 1500 },
        { service_name: "POA", subtotal: 1000 },
      ],
    },
    jurisdiction: {
      id: "jur_tx",
      state_code: "TX",
      state_name: "Texas",
      iolta_rule: "TX trust account rules apply",
      iolta_account_type: "trust",
      earning_method: "milestone",
      milestone_split: [50, 50],
      requires_informed_consent: false,
      attorney_name: "Garrison Cole",
      attorney_email: "garrison@lfl.com",
      active: true,
    },
    firm: {
      id: "firm_1",
      name: "Legacy First Law",
    },
  };

  const data = { ...defaults, ...overrides };

  const tableResponses: Record<string, Record<string, unknown>> = {
    matters: data.matter,
    fee_quotes: data.feeQuote,
    firms: data.firm,
  };

  const maybeSingleResponses: Record<string, Record<string, unknown> | null> = {
    jurisdictions: data.jurisdiction,
  };

  const chains: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};

  function createChain(tableName: string) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({
      data: tableResponses[tableName] ?? null,
      error: tableResponses[tableName] ? null : { message: "not found" },
    });
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: maybeSingleResponses[tableName] ?? null,
      error: null,
    });
    return chain;
  }

  const from = vi.fn((tableName: string) => {
    if (!chains[tableName]) {
      chains[tableName] = createChain(tableName);
    }
    return chains[tableName];
  });

  // Special case for engagement_letters insert → returns ID
  const engagementChain = createChain("engagement_letters");
  engagementChain.single.mockResolvedValue({
    data: { id: "el_1" },
    error: null,
  });
  chains["engagement_letters"] = engagementChain;

  return { from, rpc: rpcMock, _chains: chains };
}

const baseInput: GenerateLetterInput = {
  firmId: "firm_1",
  matterId: "matter_1",
  feeQuoteId: "fq_1",
  actorId: "user_1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateEngagementLetter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("assembles variables correctly and returns letter ID", async () => {
    const admin = createMockAdmin();
    const result = await generateEngagementLetter(admin as never, baseInput);

    expect(result.engagementLetterId).toBe("el_1");
    expect(result.templateKey).toBe("engagement_letter_TX");
    expect(result.variables.clientName).toBe("Jane Smith");
    expect(result.variables.totalFee).toBe(2500);
    expect(result.variables.lineItems).toHaveLength(2);
    expect(result.variables.lineItems[0].serviceName).toBe("Simple Will");
    expect(result.variables.lineItems[1].amount).toBe(1000);
    expect(result.variables.firmName).toBe("Legacy First Law");
    expect(result.variables.attorneyName).toBe("Garrison Cole");
    expect(result.variables.stateCode).toBe("TX");
    expect(result.variables.ioltaRule).toBe("TX trust account rules apply");
  });

  it("includes IOLTA language in variables", async () => {
    const admin = createMockAdmin();
    const result = await generateEngagementLetter(admin as never, baseInput);

    expect(result.variables.ioltaRule).toBeTruthy();
    expect(result.variables.ioltaAccountType).toBe("trust");
    expect(result.variables.earningMethod).toBe("milestone");
    expect(result.variables.milestoneSplit).toEqual([50, 50]);
  });

  it("errors on missing jurisdiction", async () => {
    const admin = createMockAdmin({
      jurisdiction: undefined,
    });

    // Override maybeSingle to return null for jurisdictions
    const jurChain = admin._chains["jurisdictions"];
    if (jurChain) {
      jurChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    }

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/jurisdiction/i);
  });

  it("errors on missing fee quote", async () => {
    const admin = createMockAdmin({
      feeQuote: undefined,
    });

    // Override single to return null for fee_quotes
    const fqChain = admin._chains["fee_quotes"];
    if (fqChain) {
      fqChain.single.mockResolvedValueOnce({ data: null, error: { message: "not found" } });
    }

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/fee quote/i);
  });

  it("derives template_key from state_code", async () => {
    const admin = createMockAdmin({
      matter: {
        id: "matter_1",
        matter_type: "estate_planning",
        jurisdiction: "IA",
        contact_id: "contact_1",
        contacts: {
          full_name: "Jane Smith",
          email: "jane@example.com",
          state: "IA",
        },
      },
      jurisdiction: {
        id: "jur_ia",
        state_code: "IA",
        state_name: "Iowa",
        iolta_rule: "IA trust rules",
        iolta_account_type: "trust",
        earning_method: "earned_upon_receipt",
        milestone_split: null,
        requires_informed_consent: true,
        attorney_name: "Garrison Cole",
        attorney_email: "garrison@lfl.com",
        active: true,
      },
    });

    const result = await generateEngagementLetter(admin as never, baseInput);

    expect(result.templateKey).toBe("engagement_letter_IA");
    expect(result.variables.requiresInformedConsent).toBe(true);
  });

  it("creates audit log entry", async () => {
    const admin = createMockAdmin();
    await generateEngagementLetter(admin as never, baseInput);

    expect(admin.rpc).toHaveBeenCalledWith(
      "insert_audit_log",
      expect.objectContaining({
        p_action: "engagement_letter.generated",
        p_entity_type: "engagement_letter",
        p_entity_id: "el_1",
      }),
    );
  });
});
