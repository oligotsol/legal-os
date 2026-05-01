/**
 * Gmail fetch helper tests.
 *
 * Mocks global fetch to avoid real HTTP calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listUnreadMessages,
  getFullMessage,
  markAsRead,
  extractEmail,
} from "@/lib/integrations/gmail/fetch";
import { GmailEmailError } from "@/lib/integrations/gmail/email";
import type { GmailCredentials } from "@/lib/integrations/gmail/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCreds: GmailCredentials = {
  clientId: "test-client-id.apps.googleusercontent.com",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
};

const tokenResponse = {
  access_token: "ya29.test-access-token",
  expires_in: 3600,
  token_type: "Bearer",
};

function mockFetchSequence(
  ...responses: Array<{ ok: boolean; status: number; body: unknown }>
) {
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
// extractEmail
// ---------------------------------------------------------------------------

describe("extractEmail", () => {
  it("extracts email from Name <email> format", () => {
    expect(extractEmail("Jane Doe <jane@example.com>")).toBe("jane@example.com");
  });

  it("extracts email from quoted Name format", () => {
    expect(extractEmail('"Jane Doe" <jane@example.com>')).toBe("jane@example.com");
  });

  it("returns plain email as-is (lowercased)", () => {
    expect(extractEmail("Jane@Example.COM")).toBe("jane@example.com");
  });

  it("handles email with no display name", () => {
    expect(extractEmail("<jane@example.com>")).toBe("jane@example.com");
  });
});

// ---------------------------------------------------------------------------
// listUnreadMessages
// ---------------------------------------------------------------------------

describe("listUnreadMessages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns message stubs from Gmail API", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      {
        ok: true,
        status: 200,
        body: {
          messages: [
            { id: "msg_1", threadId: "thread_1" },
            { id: "msg_2", threadId: "thread_2" },
          ],
          resultSizeEstimate: 2,
        },
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const messages = await listUnreadMessages(validCreds);

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("msg_1");
    expect(messages[1].id).toBe("msg_2");
  });

  it("returns empty array when no messages", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: true, status: 200, body: { resultSizeEstimate: 0 } },
    );
    vi.stubGlobal("fetch", fetchMock);

    const messages = await listUnreadMessages(validCreds);
    expect(messages).toHaveLength(0);
  });

  it("passes correct query params including maxResults", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: true, status: 200, body: { messages: [], resultSizeEstimate: 0 } },
    );
    vi.stubGlobal("fetch", fetchMock);

    await listUnreadMessages(validCreds, { maxResults: 5 });

    const listUrl = fetchMock.mock.calls[1][0] as string;
    expect(listUrl).toContain("maxResults=5");
    expect(listUrl).toContain("is%3Aunread");
  });

  it("throws GmailEmailError on API failure", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: false, status: 401, body: { error: { message: "Unauthorized" } } },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listUnreadMessages(validCreds)).rejects.toThrow(GmailEmailError);
  });
});

// ---------------------------------------------------------------------------
// getFullMessage
// ---------------------------------------------------------------------------

describe("getFullMessage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const plainTextMessage = {
    id: "msg_123",
    threadId: "thread_abc",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hello, I need help...",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Jane Doe <jane@example.com>" },
        { name: "To", value: "documents@legacyfirstlaw.com" },
        { name: "Subject", value: "Estate planning inquiry" },
        { name: "Date", value: "Sat, 26 Apr 2026 10:00:00 -0500" },
      ],
      body: {
        size: 30,
        // "Hello, I need help with estate planning" base64url-encoded
        data: Buffer.from("Hello, I need help with estate planning").toString("base64url"),
      },
    },
    internalDate: "1745672400000",
  };

  const multipartMessage = {
    id: "msg_456",
    threadId: "thread_def",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "I have a question...",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: '"John Smith" <john@example.com>' },
        { name: "To", value: "documents@legacyfirstlaw.com" },
        { name: "Subject", value: "Re: Your consultation" },
        { name: "Date", value: "Sat, 26 Apr 2026 11:00:00 -0500" },
        { name: "In-Reply-To", value: "<prev-msg-id@gmail.com>" },
      ],
      body: { size: 0 },
      parts: [
        {
          mimeType: "text/plain",
          headers: [],
          body: {
            size: 25,
            data: Buffer.from("I have a question about wills").toString("base64url"),
          },
        },
        {
          mimeType: "text/html",
          headers: [],
          body: {
            size: 40,
            data: Buffer.from("<p>I have a question about wills</p>").toString("base64url"),
          },
        },
      ],
    },
    internalDate: "1745676000000",
  };

  it("parses a plain text email", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: true, status: 200, body: plainTextMessage },
    );
    vi.stubGlobal("fetch", fetchMock);

    const email = await getFullMessage(validCreds, "msg_123");

    expect(email.messageId).toBe("msg_123");
    expect(email.threadId).toBe("thread_abc");
    expect(email.fromEmail).toBe("jane@example.com");
    expect(email.from).toBe("Jane Doe <jane@example.com>");
    expect(email.subject).toBe("Estate planning inquiry");
    expect(email.textBody).toBe("Hello, I need help with estate planning");
    expect(email.htmlBody).toBeNull();
    expect(email.inReplyTo).toBeNull();
  });

  it("parses a multipart email with both text and HTML", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: true, status: 200, body: multipartMessage },
    );
    vi.stubGlobal("fetch", fetchMock);

    const email = await getFullMessage(validCreds, "msg_456");

    expect(email.messageId).toBe("msg_456");
    expect(email.fromEmail).toBe("john@example.com");
    expect(email.subject).toBe("Re: Your consultation");
    expect(email.textBody).toBe("I have a question about wills");
    expect(email.htmlBody).toBe("<p>I have a question about wills</p>");
    expect(email.inReplyTo).toBe("<prev-msg-id@gmail.com>");
  });

  it("uses Bearer token in request", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: true, status: 200, body: plainTextMessage },
    );
    vi.stubGlobal("fetch", fetchMock);

    await getFullMessage(validCreds, "msg_123");

    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toContain("/messages/msg_123");
    expect(opts.headers.Authorization).toBe("Bearer ya29.test-access-token");
  });

  it("throws GmailEmailError on API failure", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: false, status: 404, body: { error: { message: "Not Found" } } },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getFullMessage(validCreds, "msg_bad")).rejects.toThrow(GmailEmailError);
  });
});

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------

describe("markAsRead", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends modify request to remove UNREAD label", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: true, status: 200, body: {} },
    );
    vi.stubGlobal("fetch", fetchMock);

    await markAsRead(validCreds, "msg_123");

    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toContain("/messages/msg_123/modify");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.removeLabelIds).toEqual(["UNREAD"]);
  });

  it("does not throw on failure (non-critical)", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, status: 200, body: tokenResponse },
      { ok: false, status: 500, body: { error: "Server error" } },
    );
    vi.stubGlobal("fetch", fetchMock);

    // Should not throw
    await markAsRead(validCreds, "msg_123");
  });
});
