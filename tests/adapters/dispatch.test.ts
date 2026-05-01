/**
 * Outbound dispatch service tests.
 *
 * Mocks the credential fetcher and adapter functions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { dispatchMessage, DispatchError } from "@/lib/dispatch/outbound";

// ---------------------------------------------------------------------------
// Mock integration credentials
// ---------------------------------------------------------------------------

const mockActiveAccount = {
  account: {
    id: "ia_1",
    firm_id: "firm_1",
    provider: "dialpad" as const,
    credentials: { apiKey: "dp_test_key" },
    status: "active",
    last_sync_at: null,
    config: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  isActive: true,
};

const mockInactiveAccount = {
  account: { ...mockActiveAccount.account, status: "inactive" },
  isActive: false,
};

vi.mock("@/lib/integrations/credentials", () => ({
  getIntegrationAccount: vi.fn(),
}));

vi.mock("@/lib/integrations/dialpad/sms", () => ({
  sendSms: vi.fn(),
  sendSmsDryRun: vi.fn(),
}));

vi.mock("@/lib/integrations/gmail/email", () => ({
  sendEmail: vi.fn(),
  sendEmailDryRun: vi.fn(),
}));

import { getIntegrationAccount } from "@/lib/integrations/credentials";
import { sendSms, sendSmsDryRun } from "@/lib/integrations/dialpad/sms";
import { sendEmail, sendEmailDryRun } from "@/lib/integrations/gmail/email";

const mockGetIntegration = vi.mocked(getIntegrationAccount);
const mockSendSms = vi.mocked(sendSms);
const mockSendSmsDryRun = vi.mocked(sendSmsDryRun);
const mockSendEmail = vi.mocked(sendEmail);
const mockSendEmailDryRun = vi.mocked(sendEmailDryRun);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outbound dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches SMS via Dialpad when channel is sms and integration is active", async () => {
    mockGetIntegration.mockResolvedValueOnce(mockActiveAccount);
    mockSendSms.mockResolvedValueOnce({
      messageId: "req_abc",
      provider: "dialpad",
      dryRun: false,
      acceptedAt: "2026-04-26T10:00:00Z",
      latencyMs: 150,
    });

    const result = await dispatchMessage("firm_1", {
      channel: "sms",
      to: "+15551234567",
      from: "+15559876543",
      body: "Your consultation is confirmed.",
    });

    expect(result.channel).toBe("sms");
    expect(result.provider).toBe("dialpad");
    expect(result.result.messageId).toBe("req_abc");
    expect(result.result.dryRun).toBe(false);
    expect(mockSendSms).toHaveBeenCalledOnce();
  });

  it("dispatches email via Gmail when channel is email and integration is active", async () => {
    const gmailAccount = {
      account: {
        ...mockActiveAccount.account,
        provider: "gmail" as const,
        credentials: {
          clientId: "cid",
          clientSecret: "csec",
          refreshToken: "rt",
        },
      },
      isActive: true,
    };
    mockGetIntegration.mockResolvedValueOnce(gmailAccount);
    mockSendEmail.mockResolvedValueOnce({
      messageId: "gmail_msg_123",
      provider: "gmail",
      dryRun: false,
      submittedAt: "2026-04-26T10:00:00Z",
      latencyMs: 250,
    });

    const result = await dispatchMessage("firm_1", {
      channel: "email",
      to: "client@example.com",
      from: "documents@legacyfirstlaw.com",
      body: "Please review.",
      subject: "Your fee quote",
    });

    expect(result.channel).toBe("email");
    expect(result.provider).toBe("gmail");
    expect(result.result.messageId).toBe("gmail_msg_123");
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("falls back to dry run when integration is inactive", async () => {
    mockGetIntegration.mockResolvedValueOnce(mockInactiveAccount);
    mockSendSmsDryRun.mockReturnValueOnce({
      messageId: "dry_run_123",
      provider: "dialpad",
      dryRun: true,
      acceptedAt: "2026-04-26T10:00:00Z",
      latencyMs: 0,
    });

    const result = await dispatchMessage("firm_1", {
      channel: "sms",
      to: "+15551234567",
      from: "+15559876543",
      body: "Test message",
    });

    expect(result.result.dryRun).toBe(true);
    expect(mockSendSmsDryRun).toHaveBeenCalledOnce();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("throws DispatchError for unsupported channel", async () => {
    try {
      await dispatchMessage("firm_1", {
        channel: "carrier_pigeon",
        to: "dest",
        from: "src",
        body: "Coo",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).message).toContain("Unsupported channel");
      expect((err as DispatchError).channel).toBe("carrier_pigeon");
    }
  });

  it("throws DispatchError when no integration account exists", async () => {
    mockGetIntegration.mockRejectedValueOnce(new Error("Not found"));

    try {
      await dispatchMessage("firm_1", {
        channel: "sms",
        to: "+15551234567",
        from: "+15559876543",
        body: "Test",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).message).toContain("No integration account");
    }
  });

  it("throws DispatchError when email dispatch missing subject", async () => {
    const gmailAccount = {
      account: {
        ...mockActiveAccount.account,
        provider: "gmail" as const,
        credentials: { clientId: "cid", clientSecret: "csec", refreshToken: "rt" },
      },
      isActive: true,
    };
    mockGetIntegration.mockResolvedValueOnce(gmailAccount);

    try {
      await dispatchMessage("firm_1", {
        channel: "email",
        to: "client@example.com",
        from: "docs@firm.com",
        body: "Hello",
        // no subject
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).message).toContain("subject");
    }
  });
});
