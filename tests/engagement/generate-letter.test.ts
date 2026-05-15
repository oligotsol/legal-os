/**
 * Tests for engagement letter generation.
 *
 * Mocks the Supabase admin client to verify: firm_config fetch + assembly,
 * the RenderLetterContext shape, template_snapshot persistence, and
 * hard-throws when any required firm_config row is missing.
 */

import { describe, it, expect, vi } from "vitest";
import {
  generateEngagementLetter,
  type GenerateLetterInput,
} from "@/lib/engagement/generate-letter";

// ---------------------------------------------------------------------------
// Fixture firm_config bundle
// ---------------------------------------------------------------------------

const SAMPLE_TEMPLATE = "<p>Dear {client_name}, fee {engagement_fee_amount}.</p>";

const GARRISON_CREDS = [
  { label: "Texas -- State Bar No.:", value: "24134411" },
  { label: "Iowa -- Commission ID:", value: "202799" },
  { label: "North Dakota -- Bar ID:", value: "10135" },
];

const BRIDGET_CREDS = [
  { label: "Pennsylvania -- Attorney ID No.:", value: "78828" },
  { label: "New Jersey -- Attorney ID No.:", value: "022801996" },
  { label: "USPTO -- Registration No.:", value: "47,333" },
];

const FIRM_CONFIG_ROWS = [
  { key: "engagement_letter_template", value: SAMPLE_TEMPLATE },
  {
    key: "firm_identity",
    value: {
      legal_name: "Legacy First Law, PLLC",
      address: "9110 N Loop 1604 W, San Antonio, TX",
      phone: "(210) 939-6881",
      fax: "(855) 785-7597",
      email: "garrison@legacyfirstlaw.com",
      website: "legacyfirstlaw.com",
    },
  },
  {
    key: "branding",
    value: {
      logo_url: null,
      primary_color: "#1a1a1a",
      secondary_color: "#6b7280",
      font_family: "Georgia, serif",
    },
  },
  {
    key: "jurisdiction_schedule",
    value: {
      TX: {
        state_code: "TX",
        state_name: "Texas",
        attorney_of_record_name: "G",
        governing_rules: "x",
        confidentiality_rule: "x",
        electronic_signatures: "x",
        venue_county: "Bexar",
        fee_dispute_program: "x",
        notary_statute: "x",
      },
      PA: {
        state_code: "PA",
        state_name: "Pennsylvania",
        attorney_of_record_name: "B",
        governing_rules: "x",
        confidentiality_rule: "x",
        electronic_signatures: "x",
        venue_county: "Philly",
        fee_dispute_program: "x",
        notary_statute: "x",
      },
    },
  },
  {
    key: "attorney_of_record_by_jurisdiction",
    value: {
      TX: { name: "Garrison English", bar_credentials: GARRISON_CREDS },
      PA: { name: "Bridget Sciamanna", bar_credentials: BRIDGET_CREDS },
    },
  },
  {
    key: "expenses_addendum_schedule",
    value: {
      fixed_service_fees: [
        { service: "eRecording", unit: "Per doc", rate: "$10.00" },
      ],
      notary_fees: [{ service: "Ack", unit: "Per sig", rate: "Per stat" }],
      by_practice_area: {
        estate_planning: {
          label: "5.1 Estate Planning",
          rows: [{ service: "Deed", unit: "Per deed", rate: "Actual" }],
        },
        business_transactional: {
          label: "5.2 Business Transactional",
          rows: [{ service: "LLC", unit: "Per filing", rate: "Actual" }],
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Mock admin client
// ---------------------------------------------------------------------------

interface MockData {
  matter?: Record<string, unknown> | null;
  feeQuote?: Record<string, unknown> | null;
  firmConfig?: Array<{ key: string; value: unknown }>;
  engagementInsert?: { id: string } | null;
}

function createMockAdmin(overrides: MockData = {}) {
  const data: Required<MockData> = {
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
      deposit_amount: 1000,
      line_items: [
        { service_name: "Simple Will", subtotal: 1500 },
        { service_name: "POA", subtotal: 1000 },
      ],
    },
    firmConfig: FIRM_CONFIG_ROWS,
    engagementInsert: { id: "el_1" },
    ...overrides,
  };

  const rpc = vi.fn().mockResolvedValue({ error: null });

  type ChainShape = {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  };

  function makeChain(tableName: string): ChainShape {
    const chain = {} as ChainShape;
    chain.select = vi.fn(() => chain);
    chain.insert = vi.fn(() => chain);
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);

    chain.single = vi.fn(async () => {
      if (tableName === "matters") {
        return data.matter
          ? { data: data.matter, error: null }
          : { data: null, error: { message: "matter not found" } };
      }
      if (tableName === "fee_quotes") {
        return data.feeQuote
          ? { data: data.feeQuote, error: null }
          : { data: null, error: { message: "fee quote not found" } };
      }
      if (tableName === "engagement_letters") {
        return data.engagementInsert
          ? { data: data.engagementInsert, error: null }
          : { data: null, error: { message: "insert failed" } };
      }
      return { data: null, error: { message: "not found" } };
    });

    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));

    // Multi-row table: firm_config returns an array via `await chain`
    chain.then = (resolve, reject) => {
      if (tableName === "firm_config") {
        return Promise.resolve({ data: data.firmConfig, error: null }).then(
          resolve,
          reject,
        );
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    };

    return chain;
  }

  const chainsByTable = new Map<string, ChainShape>();
  const from = vi.fn((tableName: string) => {
    let chain = chainsByTable.get(tableName);
    if (!chain) {
      chain = makeChain(tableName);
      chainsByTable.set(tableName, chain);
    }
    return chain;
  });
  return { from, rpc, _chains: chainsByTable };
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
  it("assembles RenderLetterContext correctly and returns letter ID", async () => {
    const admin = createMockAdmin();
    const result = await generateEngagementLetter(admin as never, baseInput);

    expect(result.engagementLetterId).toBe("el_1");
    expect(result.context.client_name).toBe("Jane Smith");
    expect(result.context.engagement_fee_amount).toBe(2500);
    expect(result.context.deposit_amount).toBe(1000);
    expect(result.context.jurisdiction).toBe("TX");
    expect(result.context.practice_area).toBe("estate_planning");
    expect(result.context.firm_identity.legal_name).toBe(
      "Legacy First Law, PLLC",
    );
    expect(result.context.jurisdiction_schedule.TX).toBeDefined();
    expect(result.context.attorney_of_record_by_jurisdiction.PA).toBeDefined();
    expect(result.context.services_description).toContain("Simple Will");
    expect(result.context.services_description).toContain("POA");
  });

  it("snapshots the template body and context into the engagement_letters row", async () => {
    const admin = createMockAdmin();
    await generateEngagementLetter(admin as never, baseInput);

    const elChain = admin._chains.get("engagement_letters");
    expect(elChain).toBeDefined();
    expect(elChain!.insert).toHaveBeenCalledTimes(1);
    const insertedRow = elChain!.insert.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(insertedRow.template_snapshot).toBe(SAMPLE_TEMPLATE);
    expect(insertedRow.template_key).toBe("engagement_letter_universal");
    expect(insertedRow.status).toBe("draft");
    const variables = insertedRow.variables as { client_name: string };
    expect(variables.client_name).toBe("Jane Smith");
  });

  it("throws when a required firm_config row is missing", async () => {
    const admin = createMockAdmin({
      firmConfig: FIRM_CONFIG_ROWS.filter((r) => r.key !== "branding"),
    });

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/Missing firm_config rows.*branding/);
  });

  it("throws when matter has no matter_type (practice_area unknown)", async () => {
    const admin = createMockAdmin({
      matter: {
        id: "matter_1",
        matter_type: null,
        jurisdiction: "TX",
        contact_id: "contact_1",
        contacts: {
          full_name: "Jane Smith",
          email: "j@x.com",
          state: "TX",
        },
      },
    });

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/matter_type/);
  });

  it("throws when jurisdiction_schedule has no entry for the matter's jurisdiction", async () => {
    const admin = createMockAdmin({
      matter: {
        id: "matter_1",
        matter_type: "estate_planning",
        jurisdiction: "ZZ",
        contact_id: "contact_1",
        contacts: {
          full_name: "Jane Smith",
          email: "j@x.com",
          state: "ZZ",
        },
      },
    });

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/jurisdiction_schedule.*"ZZ"/);
  });

  it("throws when expenses_addendum_schedule has no entry for the matter's practice_area", async () => {
    const admin = createMockAdmin({
      matter: {
        id: "matter_1",
        matter_type: "ip",
        jurisdiction: "TX",
        contact_id: "contact_1",
        contacts: {
          full_name: "Jane Smith",
          email: "j@x.com",
          state: "TX",
        },
      },
    });

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/practice_area "ip"/);
  });

  it("throws on missing fee quote", async () => {
    const admin = createMockAdmin({ feeQuote: null });

    await expect(
      generateEngagementLetter(admin as never, baseInput),
    ).rejects.toThrow(/fee quote/i);
  });

  it("creates audit log entry on success", async () => {
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
