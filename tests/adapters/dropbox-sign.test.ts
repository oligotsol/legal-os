/**
 * Dropbox Sign e-sign adapter tests.
 *
 * Mocks global fetch to avoid real HTTP calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CreateSignatureRequestInputSchema,
  type CreateSignatureRequestInput,
  type ESignCredentials,
} from "@/lib/adapters/esign";
import {
  createSignatureRequest,
  createSignatureRequestDryRun,
  getSignatureStatus,
  DropboxSignError,
} from "@/lib/integrations/dropbox-sign/esign";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCreds: ESignCredentials = {
  apiKey: "ds_test_key_123",
  testMode: true,
};

const validInput: CreateSignatureRequestInput = {
  signerEmail: "client@example.com",
  signerName: "John Doe",
  subject: "Engagement Letter",
  message: "Please sign this engagement letter.",
  title: "Engagement Letter - John Doe",
  documentContent: "This is a test document.",
  externalRef: "letter_123",
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

describe("Dropbox Sign e-sign adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates signature request and returns envelope ID", async () => {
    const fetchMock = mockFetchOk({
      signature_request: {
        signature_request_id: "sig_abc123",
        signing_url: "https://app.hellosign.com/sign/abc123",
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSignatureRequest(validCreds, validInput);

    expect(result.envelopeId).toBe("sig_abc123");
    expect(result.signUrl).toBe("https://app.hellosign.com/sign/abc123");
    expect(result.provider).toBe("dropbox_sign");
    expect(result.dryRun).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends correct auth header (Basic with API key)", async () => {
    const fetchMock = mockFetchOk({
      signature_request: {
        signature_request_id: "sig_456",
        signing_url: null,
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await createSignatureRequest(validCreds, validInput);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.hellosign.com/v3/signature_request/send");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Basic ${btoa("ds_test_key_123:")}`);
  });

  it("validates input — rejects missing signer email", () => {
    expect(() =>
      CreateSignatureRequestInputSchema.parse({
        ...validInput,
        signerEmail: "",
      }),
    ).toThrow();
  });

  it("validates input — rejects missing title", () => {
    expect(() =>
      CreateSignatureRequestInputSchema.parse({
        ...validInput,
        title: "",
      }),
    ).toThrow();
  });

  it("validates credentials — rejects missing API key", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      createSignatureRequest({ apiKey: "" }, validInput),
    ).rejects.toThrow();
  });

  it("throws DropboxSignError on HTTP error response", async () => {
    vi.stubGlobal("fetch", mockFetchError(401, "Unauthorized"));

    try {
      await createSignatureRequest(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DropboxSignError);
      const dsErr = err as DropboxSignError;
      expect(dsErr.statusCode).toBe(401);
      expect(dsErr.message).toContain("401");
    }
  });

  it("throws DropboxSignError on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Connection refused")),
    );

    try {
      await createSignatureRequest(validCreds, validInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DropboxSignError);
      expect((err as DropboxSignError).message).toMatch(/Network error/);
    }
  });

  it("dry run returns result without calling fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = createSignatureRequestDryRun(validInput);

    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("dropbox_sign");
    expect(result.envelopeId).toMatch(/^dry_run_/);
    expect(result.latencyMs).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets signature status — signed", async () => {
    const fetchMock = mockFetchOk({
      signature_request: {
        signature_request_id: "sig_completed",
        is_complete: true,
        is_declined: false,
        signatures: [
          { status_code: "signed", signed_at: 1700000000 },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSignatureStatus(validCreds, "sig_completed");

    expect(result.envelopeId).toBe("sig_completed");
    expect(result.status).toBe("signed");
    expect(result.signedAt).toBeTruthy();
  });

  it("gets signature status — awaiting", async () => {
    const fetchMock = mockFetchOk({
      signature_request: {
        signature_request_id: "sig_pending",
        is_complete: false,
        is_declined: false,
        signatures: [
          { status_code: "awaiting_signature", signed_at: null },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSignatureStatus(validCreds, "sig_pending");

    expect(result.status).toBe("awaiting_signature");
    expect(result.signedAt).toBeNull();
  });

  it("gets signature status — declined", async () => {
    const fetchMock = mockFetchOk({
      signature_request: {
        signature_request_id: "sig_declined",
        is_complete: false,
        is_declined: true,
        signatures: [],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSignatureStatus(validCreds, "sig_declined");

    expect(result.status).toBe("declined");
  });
});
