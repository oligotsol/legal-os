/**
 * Gmail email adapter tests.
 *
 * Mocks global fetch to avoid real HTTP calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendEmailInputSchema, type SendEmailInput, type EmailCredentials } from "@/lib/adapters/email";
import {
  sendEmail,
  sendEmailDryRun,
  GmailEmailError,
  getAccessToken,
  buildMimeMessage,
} from "@/lib/integrations/gmail/email";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCreds: EmailCredentials = {
  clientId: "test-client-id.apps.googleusercontent.com",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
};

const validInput: SendEmailInput = {
  to: "client@example.com",
  from: "documents@legacyfirstlaw.com",
  subject: "Your fee quote is ready",
  htmlBody: "<p>Please review the attached fee quote.</p>",
  textBody: "Please review the attached fee quote.",
};

const tokenOkResponse = {
  access_token: "ya29.test-access-token",
  expires_in: 3600,
  token_type: "Bearer",
};

const gmailSendOkResponse = {
  id: "gmail_msg_abc123",
  threadId: "thread_xyz",
  labelIds: ["SENT"],
};

function mockFetchSequence(...responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  }
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Gmail email adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges refresh token and sends email via Gmail API", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenOkResponse },
      { ok: true, status: 200, body: gmailSendOkResponse },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmail(validCreds, validInput);

    expect(result.messageId).toBe("gmail_msg_abc123");
    expect(result.provider).toBe("gmail");
    expect(result.dryRun).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends correct OAuth2 token request", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenOkResponse },
      { ok: true, status: 200, body: gmailSendOkResponse },
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(validCreds, validInput);

    const [tokenUrl, tokenOpts] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(tokenOpts.method).toBe("POST");
    expect(tokenOpts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const params = new URLSearchParams(tokenOpts.body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(params.get("client_secret")).toBe("test-client-secret");
    expect(params.get("refresh_token")).toBe("test-refresh-token");
  });

  it("sends base64url-encoded MIME message with Bearer auth", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenOkResponse },
      { ok: true, status: 200, body: gmailSendOkResponse },
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(validCreds, validInput);

    const [sendUrl, sendOpts] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(sendOpts.headers.Authorization).toBe("Bearer ya29.test-access-token");
    expect(sendOpts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(sendOpts.body);
    expect(body.raw).toBeTruthy();
    // Decode and check it contains the headers
    const decoded = Buffer.from(body.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("From: documents@legacyfirstlaw.com");
    expect(decoded).toContain("To: client@example.com");
    expect(decoded).toContain("Subject: Your fee quote is ready");
  });

  it("throws GmailEmailError on OAuth2 token failure", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence(
        { ok: false, status: 401, body: { error: "invalid_grant" } },
      ),
    );

    try {
      await sendEmail(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GmailEmailError);
      expect((err as GmailEmailError).statusCode).toBe(401);
      expect((err as GmailEmailError).message).toContain("token exchange failed");
    }
  });

  it("throws GmailEmailError on Gmail API error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence(
        { ok: true, status: 200, body: tokenOkResponse },
        { ok: false, status: 403, body: { error: { message: "Insufficient Permission" } } },
      ),
    );

    try {
      await sendEmail(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GmailEmailError);
      expect((err as GmailEmailError).statusCode).toBe(403);
      expect((err as GmailEmailError).message).toContain("Gmail API returned 403");
    }
  });

  it("throws GmailEmailError on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Connection refused")),
    );

    try {
      await sendEmail(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GmailEmailError);
      expect((err as GmailEmailError).message).toContain("Network error");
    }
  });

  it("validates credentials — rejects missing fields", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      sendEmail({ clientId: "", clientSecret: "x", refreshToken: "y" }, validInput),
    ).rejects.toThrow();

    await expect(
      sendEmail({}, validInput),
    ).rejects.toThrow();
  });

  it("dry run returns result without calling fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = sendEmailDryRun(validInput);

    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("gmail");
    expect(result.messageId).toMatch(/^dry_run_/);
    expect(result.latencyMs).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MIME builder tests
// ---------------------------------------------------------------------------

describe("buildMimeMessage", () => {
  it("builds multipart/alternative when both HTML and text provided", () => {
    const mime = buildMimeMessage(validInput);
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("text/plain");
    expect(mime).toContain("text/html");
    expect(mime).toContain("Please review the attached fee quote.");
    expect(mime).toContain("<p>Please review the attached fee quote.</p>");
  });

  it("builds text/html when only HTML provided", () => {
    const mime = buildMimeMessage({
      ...validInput,
      textBody: undefined,
    });
    expect(mime).toContain("Content-Type: text/html");
    expect(mime).not.toContain("multipart/alternative");
  });

  it("builds text/plain when only text provided", () => {
    const mime = buildMimeMessage({
      ...validInput,
      htmlBody: undefined,
    });
    expect(mime).toContain("Content-Type: text/plain");
    expect(mime).not.toContain("multipart/alternative");
  });

  it("includes Reply-To header when specified", () => {
    const mime = buildMimeMessage({
      ...validInput,
      replyTo: "reply@legacyfirstlaw.com",
    });
    expect(mime).toContain("Reply-To: reply@legacyfirstlaw.com");
  });
});

// ---------------------------------------------------------------------------
// Token exchange tests
// ---------------------------------------------------------------------------

describe("getAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns access token on success", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence({ ok: true, status: 200, body: tokenOkResponse }),
    );

    const token = await getAccessToken({
      clientId: "cid",
      clientSecret: "csec",
      refreshToken: "rt",
    });

    expect(token).toBe("ya29.test-access-token");
  });
});
