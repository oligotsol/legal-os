/**
 * Postmark email adapter tests.
 *
 * Mocks global fetch to avoid real HTTP calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendEmailInputSchema, type SendEmailInput, type EmailCredentials } from "@/lib/adapters/email";
import { sendEmail, sendEmailDryRun, PostmarkEmailError } from "@/lib/integrations/postmark/email";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCreds: EmailCredentials = { serverToken: "pm_test_token_xyz" };

const validInput: SendEmailInput = {
  to: "client@example.com",
  from: "firm@lawfirm.com",
  subject: "Your fee quote is ready",
  htmlBody: "<p>Please review the attached fee quote.</p>",
  textBody: "Please review the attached fee quote.",
};

const postmarkOkResponse = {
  To: "client@example.com",
  SubmittedAt: "2026-04-26T10:00:00Z",
  MessageID: "msg_abc123",
  ErrorCode: 0,
  Message: "OK",
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Postmark email adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends email and returns result with Postmark message ID", async () => {
    vi.stubGlobal("fetch", mockFetchOk(postmarkOkResponse));

    const result = await sendEmail(validCreds, validInput);

    expect(result.messageId).toBe("msg_abc123");
    expect(result.provider).toBe("postmark");
    expect(result.dryRun).toBe(false);
    expect(result.submittedAt).toBe("2026-04-26T10:00:00Z");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("builds the correct request shape and auth header", async () => {
    const fetchMock = mockFetchOk(postmarkOkResponse);
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(validCreds, {
      ...validInput,
      replyTo: "reply@lawfirm.com",
      tag: "fee-quote",
      metadata: { matter_id: "m_123" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-Postmark-Server-Token"]).toBe("pm_test_token_xyz");

    const body = JSON.parse(opts.body);
    expect(body.From).toBe("firm@lawfirm.com");
    expect(body.To).toBe("client@example.com");
    expect(body.Subject).toBe("Your fee quote is ready");
    expect(body.HtmlBody).toBeTruthy();
    expect(body.TextBody).toBeTruthy();
    expect(body.ReplyTo).toBe("reply@lawfirm.com");
    expect(body.Tag).toBe("fee-quote");
    expect(body.Metadata).toEqual({ matter_id: "m_123" });
  });

  it("requires at least one of htmlBody or textBody", () => {
    // Neither provided — should fail
    expect(() =>
      SendEmailInputSchema.parse({
        to: "a@b.com",
        from: "c@d.com",
        subject: "Test",
      }),
    ).toThrow(/htmlBody.*textBody/i);

    // Only htmlBody — should pass
    expect(() =>
      SendEmailInputSchema.parse({
        to: "a@b.com",
        from: "c@d.com",
        subject: "Test",
        htmlBody: "<p>Hi</p>",
      }),
    ).not.toThrow();

    // Only textBody — should pass
    expect(() =>
      SendEmailInputSchema.parse({
        to: "a@b.com",
        from: "c@d.com",
        subject: "Test",
        textBody: "Hi",
      }),
    ).not.toThrow();
  });

  it("validates credentials — rejects empty server token", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      sendEmail({ serverToken: "" }, validInput),
    ).rejects.toThrow();
  });

  it("throws PostmarkEmailError with error code on API error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchError(422, { ErrorCode: 300, Message: "Invalid 'From' address" }),
    );

    try {
      await sendEmail(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PostmarkEmailError);
      const pmErr = err as PostmarkEmailError;
      expect(pmErr.statusCode).toBe(422);
      expect(pmErr.errorCode).toBe(300);
      expect(pmErr.message).toContain("Invalid 'From' address");
    }
  });

  it("throws PostmarkEmailError on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Connection refused")),
    );

    try {
      await sendEmail(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PostmarkEmailError);
      expect((err as PostmarkEmailError).message).toMatch(/Network error/);
    }
  });

  it("dry run returns result without calling fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = sendEmailDryRun(validInput);

    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("postmark");
    expect(result.messageId).toMatch(/^dry_run_/);
    expect(result.latencyMs).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes metadata through to the request body", async () => {
    const fetchMock = mockFetchOk(postmarkOkResponse);
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(validCreds, {
      ...validInput,
      metadata: { lead_id: "l_456", campaign: "drip-1" },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.Metadata).toEqual({ lead_id: "l_456", campaign: "drip-1" });
  });

  it("omits optional fields when not provided", async () => {
    const fetchMock = mockFetchOk(postmarkOkResponse);
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(validCreds, {
      to: "a@b.com",
      from: "c@d.com",
      subject: "Minimal",
      textBody: "Hi",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.HtmlBody).toBeUndefined();
    expect(body.ReplyTo).toBeUndefined();
    expect(body.Tag).toBeUndefined();
    expect(body.Metadata).toBeUndefined();
  });
});
