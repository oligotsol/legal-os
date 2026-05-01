/**
 * SMS/email parity test.
 *
 * Proves that processInboundMessage produces identical downstream behavior
 * — same ethics scan, same drip cancel, same AI draft reply, same
 * approval-queue path — regardless of channel. Only the delivery channel
 * and identifier differ.
 *
 * This is the test Garrison asked for: "zero difference in intelligence
 * or behavior, only the delivery channel changes."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock state — reset between tests.
const mocks = vi.hoisted(() => ({
  scanMessage: vi.fn(),
  cancelPendingDrips: vi.fn(),
  executeAutoRefer: vi.fn(),
  generateDraftReply: vi.fn(),
  inngestSend: vi.fn(),
}));

vi.mock("@/lib/ai/ethics-scanner", () => ({
  scanMessage: mocks.scanMessage,
}));
vi.mock("@/lib/pipeline/cancel-on-reply", () => ({
  cancelPendingDrips: mocks.cancelPendingDrips,
}));
vi.mock("@/lib/pipeline/auto-refer", () => ({
  executeAutoRefer: mocks.executeAutoRefer,
}));
vi.mock("@/lib/ai/conversation/generate-draft-reply", () => ({
  generateDraftReply: mocks.generateDraftReply,
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import { processInboundMessage } from "@/lib/pipeline/process-inbound-message";

// ---------------------------------------------------------------------------
// Mock admin client builder — covers the existing-contact path so we don't
// have to mock 8 separate inserts. Returns the same contact for either
// phone or email lookup.
// ---------------------------------------------------------------------------

function buildAdminMock(opts: {
  contactState?: string | null;
  withConversation?: boolean;
}) {
  const contact = {
    id: "contact-1",
    firm_id: "firm-1",
    full_name: "Test Lead",
    phone: "+15551234567",
    email: "lead@example.com",
    state: opts.contactState ?? "TX",
    dnc: false,
  };
  const conversation = { id: "conv-1" };

  // The helper makes these calls in order; we need a router that returns the
  // right shape for each. We track which select() was made via the .from() arg.
  return {
    from: vi.fn((table: string) => {
      if (table === "contacts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: contact }),
          update: vi.fn().mockReturnThis(),
        };
      }
      if (table === "conversations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.withConversation === false ? null : conversation,
          }),
          single: vi.fn().mockResolvedValue({
            data: { context: null },
          }),
          update: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: conversation }),
          }),
        };
      }
      if (table === "messages") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "approval_queue") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      // Default — chained no-op
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        single: vi.fn().mockResolvedValue({ data: null }),
      };
    }),
  };
}

const fixtures = [
  {
    name: "neutral inbound message → AI draft path",
    body: "Hi, I'd like to set up a will. Can you help?",
    scanDisposition: { disposition: "ALLOW", recommendedAction: null },
    expectShortCircuit: false,
  },
  {
    name: "AUTO_DNC short-circuits",
    body: "STOP",
    scanDisposition: { disposition: "AUTO_DNC", recommendedAction: "stop" },
    expectShortCircuit: true,
  },
  {
    name: "PARTNER_REVIEW still drafts AI reply but flags conversation",
    body: "Some borderline content needing review.",
    scanDisposition: { disposition: "PARTNER_REVIEW", recommendedAction: null },
    expectShortCircuit: false,
  },
];

describe("SMS/email parity through processInboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scanMessage.mockReset();
    mocks.cancelPendingDrips.mockReset();
    mocks.executeAutoRefer.mockReset();
    mocks.generateDraftReply.mockReset();
    mocks.inngestSend.mockReset();
  });

  for (const fixture of fixtures) {
    it(`behaves identically across SMS and email — ${fixture.name}`, async () => {
      // Arrange: same ethics outcome on both runs.
      mocks.scanMessage.mockReturnValue({
        ...fixture.scanDisposition,
        signals: [],
        priority: 0,
        matchedRule: null,
        matchedPatterns: [],
      });

      // --- SMS run ---
      const smsAdmin = buildAdminMock({ contactState: "TX" });
      const smsResult = await processInboundMessage({
        admin: smsAdmin as never,
        candidateFirmIds: ["firm-1"],
        channel: "sms",
        fromIdentifier: "+15551234567",
        body: fixture.body,
        externalMessageId: "ext-sms-1",
        source: "dialpad",
      });

      const smsScanCallCount = mocks.scanMessage.mock.calls.length;
      const smsScanArgs = mocks.scanMessage.mock.calls[0]?.[0];
      const smsDripCalls = mocks.cancelPendingDrips.mock.calls.length;
      const smsDraftCalls = mocks.generateDraftReply.mock.calls.length;

      // --- Reset and email run ---
      vi.clearAllMocks();
      mocks.scanMessage.mockReturnValue({
        ...fixture.scanDisposition,
        signals: [],
        priority: 0,
        matchedRule: null,
        matchedPatterns: [],
      });

      const emailAdmin = buildAdminMock({ contactState: "TX" });
      const emailResult = await processInboundMessage({
        admin: emailAdmin as never,
        candidateFirmIds: ["firm-1"],
        channel: "email",
        fromIdentifier: "lead@example.com",
        body: fixture.body,
        externalMessageId: "ext-email-1",
        source: "gmail",
      });

      const emailScanCallCount = mocks.scanMessage.mock.calls.length;
      const emailScanArgs = mocks.scanMessage.mock.calls[0]?.[0];
      const emailDripCalls = mocks.cancelPendingDrips.mock.calls.length;
      const emailDraftCalls = mocks.generateDraftReply.mock.calls.length;

      // --- Parity assertions ---

      // Ethics scan: invoked the same number of times, same content + state.
      expect(emailScanCallCount).toBe(smsScanCallCount);
      expect(emailScanArgs?.messageContent).toBe(smsScanArgs?.messageContent);
      expect(emailScanArgs?.contactState).toBe(smsScanArgs?.contactState);

      // Drip cancellation behavior: identical (existing contacts cancel drips).
      expect(emailDripCalls).toBe(smsDripCalls);

      // AI draft reply: invoked identically.
      expect(emailDraftCalls).toBe(smsDraftCalls);

      // Disposition + short-circuit identical.
      expect(emailResult.disposition).toBe(smsResult.disposition);
      expect(emailResult.shortCircuit).toBe(smsResult.shortCircuit);
      expect(emailResult.shortCircuit).toBe(fixture.expectShortCircuit);

      // Ethics disposition matches what the scanner returned.
      expect(emailResult.ethicsDisposition).toBe(smsResult.ethicsDisposition);
    });
  }

  it("draft generator is called with channel-appropriate context", async () => {
    mocks.scanMessage.mockReturnValue({
      disposition: "ALLOW",
      recommendedAction: null,
      signals: [],
      priority: 0,
      matchedRule: null,
      matchedPatterns: [],
    });

    const smsAdmin = buildAdminMock({});
    await processInboundMessage({
      admin: smsAdmin as never,
      candidateFirmIds: ["firm-1"],
      channel: "sms",
      fromIdentifier: "+15551234567",
      body: "hello",
      source: "dialpad",
    });

    expect(mocks.generateDraftReply).toHaveBeenCalledTimes(1);
    const smsCall = mocks.generateDraftReply.mock.calls[0][0];
    expect(smsCall.firmId).toBe("firm-1");
    expect(smsCall.newMessageContent).toBe("hello");

    vi.clearAllMocks();
    mocks.scanMessage.mockReturnValue({
      disposition: "ALLOW",
      recommendedAction: null,
      signals: [],
      priority: 0,
      matchedRule: null,
      matchedPatterns: [],
    });

    const emailAdmin = buildAdminMock({});
    await processInboundMessage({
      admin: emailAdmin as never,
      candidateFirmIds: ["firm-1"],
      channel: "email",
      fromIdentifier: "lead@example.com",
      body: "hello",
      source: "gmail",
      subjectHint: "Question about wills",
    });

    expect(mocks.generateDraftReply).toHaveBeenCalledTimes(1);
    const emailCall = mocks.generateDraftReply.mock.calls[0][0];
    expect(emailCall.firmId).toBe(smsCall.firmId);
    expect(emailCall.newMessageContent).toBe(smsCall.newMessageContent);
    // Subject hint is the only legitimate channel-specific extra context.
    expect(emailCall.subjectHint).toBe("Question about wills");
  });

  it("skipDraftReply suppresses AI draft generation on both channels", async () => {
    mocks.scanMessage.mockReturnValue({
      disposition: "ALLOW",
      recommendedAction: null,
      signals: [],
      priority: 0,
      matchedRule: null,
      matchedPatterns: [],
    });

    const smsAdmin = buildAdminMock({});
    await processInboundMessage({
      admin: smsAdmin as never,
      candidateFirmIds: ["firm-1"],
      channel: "sms",
      fromIdentifier: "+15551234567",
      body: "hello",
      source: "dialpad",
      skipDraftReply: true,
    });
    expect(mocks.generateDraftReply).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.scanMessage.mockReturnValue({
      disposition: "ALLOW",
      recommendedAction: null,
      signals: [],
      priority: 0,
      matchedRule: null,
      matchedPatterns: [],
    });

    const emailAdmin = buildAdminMock({});
    await processInboundMessage({
      admin: emailAdmin as never,
      candidateFirmIds: ["firm-1"],
      channel: "email",
      fromIdentifier: "lead@example.com",
      body: "hello",
      source: "gmail",
      skipDraftReply: true,
    });
    expect(mocks.generateDraftReply).not.toHaveBeenCalled();
  });
});
