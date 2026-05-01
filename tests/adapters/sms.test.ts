/**
 * Dialpad SMS adapter tests.
 *
 * Mocks global fetch to avoid real HTTP calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendSmsInputSchema, type SendSmsInput, type SmsCredentials } from "@/lib/adapters/sms";
import { sendSms, sendSmsDryRun, DialpadSmsError } from "@/lib/integrations/dialpad/sms";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCreds: SmsCredentials = { apiKey: "dp_test_key_123" };

const validInput: SendSmsInput = {
  to: "+15551234567",
  from: "+15559876543",
  body: "Your consultation is confirmed for tomorrow at 2 PM.",
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dialpad SMS adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends SMS and returns result with provider message ID", async () => {
    const fetchMock = mockFetchOk({ request_id: "req_abc123" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSms(validCreds, validInput);

    expect(result.messageId).toBe("req_abc123");
    expect(result.provider).toBe("dialpad");
    expect(result.dryRun).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.acceptedAt).toBeTruthy();
  });

  it("builds the correct request shape and auth header", async () => {
    const fetchMock = mockFetchOk({ request_id: "req_456" });
    vi.stubGlobal("fetch", fetchMock);

    await sendSms(validCreds, validInput);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dialpad.com/api/v2/sms");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer dp_test_key_123");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.to_number).toBe("+15551234567");
    expect(body.from_number).toBe("+15559876543");
    expect(body.text).toBe("Your consultation is confirmed for tomorrow at 2 PM.");
  });

  it("validates input — rejects invalid phone numbers", () => {
    expect(() =>
      SendSmsInputSchema.parse({ ...validInput, to: "not-a-phone" }),
    ).toThrow();

    expect(() =>
      SendSmsInputSchema.parse({ ...validInput, to: "5551234567" }), // missing +
    ).toThrow();
  });

  it("validates input — rejects empty body", () => {
    expect(() =>
      SendSmsInputSchema.parse({ ...validInput, body: "" }),
    ).toThrow();
  });

  it("validates credentials — rejects missing API key", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      sendSms({ apiKey: "" }, validInput),
    ).rejects.toThrow();
  });

  it("throws DialpadSmsError on HTTP error response", async () => {
    vi.stubGlobal("fetch", mockFetchError(401, "Unauthorized"));

    try {
      await sendSms(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DialpadSmsError);
      const smsErr = err as DialpadSmsError;
      expect(smsErr.statusCode).toBe(401);
      expect(smsErr.message).toContain("401");
    }
  });

  it("throws DialpadSmsError on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("DNS resolution failed")),
    );

    try {
      await sendSms(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DialpadSmsError);
      expect((err as DialpadSmsError).message).toMatch(/Network error/);
    }
  });

  it("dry run returns result without calling fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = sendSmsDryRun(validInput);

    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("dialpad");
    expect(result.messageId).toMatch(/^dry_run_/);
    expect(result.latencyMs).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
