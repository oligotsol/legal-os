/**
 * Gmail API read helpers — list unread messages and fetch full content.
 *
 * Uses raw fetch() with OAuth2 Bearer token. No googleapis dependency.
 * These are used by the Gmail poller Inngest function.
 */

import { z } from "zod";
import { GmailEmailError, getAccessToken } from "./email";
import type { GmailCredentials } from "./types";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GmailMessageIdSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

const GmailListResponseSchema = z.object({
  messages: z.array(GmailMessageIdSchema).optional().default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

const GmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

// ---------------------------------------------------------------------------
// Recursive part type — defined as interface to avoid z.lazy() losing types
// ---------------------------------------------------------------------------

interface GmailPart {
  mimeType: string;
  headers: Array<{ name: string; value: string }>;
  body: { size: number; data?: string };
  parts?: GmailPart[];
}

/**
 * Validate the top-level message shape. Parts are validated loosely
 * (passthrough) since they're recursive — we type-check via the
 * GmailPart interface at usage sites instead.
 */
const GmailFullMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional().default([]),
  snippet: z.string().optional(),
  payload: z.object({
    mimeType: z.string(),
    headers: z.array(GmailHeaderSchema).optional().default([]),
    body: z.object({
      size: z.number(),
      data: z.string().optional(),
    }),
    parts: z.array(z.any()).optional(),
  }),
  internalDate: z.string(),
});

export interface GmailFullMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet?: string;
  payload: {
    mimeType: string;
    headers: Array<{ name: string; value: string }>;
    body: { size: number; data?: string };
    parts?: GmailPart[];
  };
  internalDate: string;
}

// ---------------------------------------------------------------------------
// Parsed email type
// ---------------------------------------------------------------------------

export interface ParsedEmail {
  messageId: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  date: string;
  internalDate: string;
  inReplyTo: string | null;
}

// ---------------------------------------------------------------------------
// List unread messages
// ---------------------------------------------------------------------------

/**
 * List unread messages from the inbox, optionally after a given history ID.
 * Returns up to `maxResults` message stubs (id + threadId).
 *
 * **Always scoped by label.** Without a label filter the poller would
 * pick up every unread email in the user's inbox — newsletters, system
 * mail, personal threads — and create Legal OS leads for each one.
 * Callers must pass `labelQuery` (e.g. `"legal-os-intake"`) so only
 * intake-labeled mail is fetched. Set up: Garrison creates a Gmail
 * label and an inbound filter rule that applies it to intake mail.
 */
export async function listUnreadMessages(
  credentials: GmailCredentials,
  options: {
    /** Required Gmail label name. Mail without this label is ignored. */
    labelQuery: string;
    maxResults?: number;
    /** Only fetch messages newer than this Gmail message ID */
    afterMessageId?: string;
  },
): Promise<Array<{ id: string; threadId: string }>> {
  const accessToken = await getAccessToken(credentials);
  const maxResults = options.maxResults ?? 20;

  if (!options.labelQuery || !options.labelQuery.trim()) {
    throw new GmailEmailError(
      "listUnreadMessages requires a labelQuery — refusing to fetch the entire inbox",
    );
  }

  // Query: any mail in the last 24h with the intake label.
  // We deliberately do NOT require `is:unread` or `in:inbox`:
  //   - is:unread misses any email Garrison already opened in Gmail.
  //   - in:inbox misses any "Skip the Inbox" filter routing.
  // Self-loop avoidance is NOT in this query — `-from:me` was too broad
  // (excluded any address linked to the OAuth'd Google account, not just
  // the firm's send-address). The downstream `firmFrom` check in
  // gmail-poller.ts compares against `firm_config.email_config.default_from`
  // and is the authoritative loop guard.
  // De-duplication is handled downstream via webhook_events.idempotency_key
  // (keyed by Gmail message id) so re-listing already-processed mail is a
  // cheap no-op.
  let q = `newer_than:1d label:${options.labelQuery}`;
  if (options.afterMessageId) {
    q += ` after:${options.afterMessageId}`;
  }

  const params = new URLSearchParams({
    q,
    maxResults: String(maxResults),
  });

  let response: Response;
  try {
    response = await fetch(`${GMAIL_API_BASE}/messages?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new GmailEmailError(
      `Network error listing Gmail messages: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  }

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "(unable to read response body)";
    }
    throw new GmailEmailError(
      `Gmail list API returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = GmailListResponseSchema.parse(json);
  return parsed.messages;
}

// ---------------------------------------------------------------------------
// Get full message
// ---------------------------------------------------------------------------

/**
 * Fetch a full message by ID, returning parsed headers + body.
 */
export async function getFullMessage(
  credentials: GmailCredentials,
  messageId: string,
): Promise<ParsedEmail> {
  const accessToken = await getAccessToken(credentials);

  let response: Response;
  try {
    response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new GmailEmailError(
      `Network error fetching Gmail message ${messageId}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  }

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "(unable to read response body)";
    }
    throw new GmailEmailError(
      `Gmail get API returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const msg = GmailFullMessageSchema.parse(json);

  return parseGmailMessage(msg);
}

// ---------------------------------------------------------------------------
// Mark as read
// ---------------------------------------------------------------------------

/**
 * Mark a message as read by removing the UNREAD label.
 */
export async function markAsRead(
  credentials: GmailCredentials,
  messageId: string,
): Promise<void> {
  const accessToken = await getAccessToken(credentials);

  const response = await fetch(
    `${GMAIL_API_BASE}/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    },
  );

  if (!response.ok) {
    // Non-critical — log but don't throw
    console.warn(`Failed to mark Gmail message ${messageId} as read: ${response.status}`);
  }
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseGmailMessage(msg: GmailFullMessage): ParsedEmail {
  const headers = msg.payload.headers;
  const getHeader = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  const fromRaw = getHeader("From");
  const fromEmail = extractEmail(fromRaw);

  // Extract body from payload
  const { textBody, htmlBody } = extractBodies(msg.payload);

  return {
    messageId: msg.id,
    threadId: msg.threadId,
    from: fromRaw,
    fromEmail,
    to: getHeader("To"),
    subject: getHeader("Subject"),
    textBody,
    htmlBody,
    date: getHeader("Date"),
    internalDate: msg.internalDate,
    inReplyTo: getHeader("In-Reply-To") || null,
  };
}

/**
 * Extract email address from "Name <email>" or plain "email" format.
 */
export function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  // Plain email
  return from.trim().toLowerCase();
}

/**
 * Recursively extract text/plain and text/html bodies from a Gmail message payload.
 */
function extractBodies(payload: GmailFullMessage["payload"]): {
  textBody: string;
  htmlBody: string | null;
} {
  let textBody = "";
  let htmlBody: string | null = null;

  // Single-part message
  if (!payload.parts || payload.parts.length === 0) {
    const decoded = decodeBase64Url(payload.body.data ?? "");
    if (payload.mimeType === "text/plain") {
      textBody = decoded;
    } else if (payload.mimeType === "text/html") {
      htmlBody = decoded;
    }
    return { textBody, htmlBody };
  }

  // Multipart message — recurse
  for (const part of payload.parts) {
    if (part.mimeType === "text/plain" && part.body.data) {
      textBody = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body.data) {
      htmlBody = decodeBase64Url(part.body.data);
    } else if (part.parts) {
      // Nested multipart (e.g. multipart/alternative inside multipart/mixed)
      const nested = extractBodies({
        mimeType: part.mimeType,
        headers: part.headers,
        body: part.body,
        parts: part.parts,
      });
      if (nested.textBody && !textBody) textBody = nested.textBody;
      if (nested.htmlBody && !htmlBody) htmlBody = nested.htmlBody;
    }
  }

  return { textBody, htmlBody };
}

/**
 * Decode base64url-encoded string (Gmail API format).
 */
function decodeBase64Url(data: string): string {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}
