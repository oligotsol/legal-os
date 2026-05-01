/**
 * Gmail email adapter — sends email via Gmail API with OAuth2.
 *
 * Pure function: takes credentials + input, returns result.
 * Does NOT write to the database — caller handles messages table + audit_log.
 *
 * OAuth2 flow: exchange refresh token for access token, build RFC 2822 MIME
 * message, POST base64url-encoded to Gmail API.
 */

import {
  SendEmailInputSchema,
  type SendEmailInput,
  type SendEmailResult,
  type EmailCredentials,
} from "@/lib/adapters/email";
import {
  GmailCredentialsSchema,
  GmailTokenResponseSchema,
  GmailSendResponseSchema,
} from "./types";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class GmailEmailError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GmailEmailError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Exchange a refresh token for a short-lived access token.
 */
export async function getAccessToken(credentials: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new GmailEmailError(
      `Network error during OAuth2 token exchange: ${err instanceof Error ? err.message : String(err)}`,
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
      `OAuth2 token exchange failed with ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = GmailTokenResponseSchema.parse(json);
  return parsed.access_token;
}

/**
 * Build an RFC 2822 MIME message from the email input.
 */
export function buildMimeMessage(input: SendEmailInput): string {
  const boundary = `boundary_${Date.now()}`;
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `MIME-Version: 1.0`,
  ];

  if (input.replyTo) {
    headers.push(`Reply-To: ${input.replyTo}`);
  }

  // If both HTML and text, use multipart/alternative
  if (input.htmlBody && input.textBody) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      input.textBody,
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      input.htmlBody,
      `--${boundary}--`,
    ];
    return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
  }

  // Single content type
  if (input.htmlBody) {
    headers.push(`Content-Type: text/html; charset=utf-8`);
    return headers.join("\r\n") + "\r\n\r\n" + input.htmlBody;
  }

  headers.push(`Content-Type: text/plain; charset=utf-8`);
  return headers.join("\r\n") + "\r\n\r\n" + (input.textBody ?? "");
}

/**
 * Base64url-encode a string (RFC 4648 §5).
 */
function base64urlEncode(str: string): string {
  const base64 = Buffer.from(str, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export function sendEmailDryRun(input: SendEmailInput): SendEmailResult {
  SendEmailInputSchema.parse(input);
  return {
    messageId: `dry_run_${Date.now()}`,
    provider: "gmail",
    dryRun: true,
    submittedAt: new Date().toISOString(),
    latencyMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export async function sendEmail(
  credentials: EmailCredentials,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  // Validate inputs
  const parsedCreds = GmailCredentialsSchema.parse(credentials);
  const parsedInput = SendEmailInputSchema.parse(input);

  const start = performance.now();

  // Step 1: Get access token
  const accessToken = await getAccessToken(parsedCreds);

  // Step 2: Build MIME message and base64url-encode it
  const mimeMessage = buildMimeMessage(parsedInput);
  const encodedMessage = base64urlEncode(mimeMessage);

  // Step 3: Send via Gmail API
  let response: Response;
  try {
    response = await fetch(GMAIL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });
  } catch (err) {
    throw new GmailEmailError(
      `Network error calling Gmail API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  }

  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "(unable to read response body)";
    }
    throw new GmailEmailError(
      `Gmail API returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = GmailSendResponseSchema.parse(json);

  return {
    messageId: parsed.id,
    provider: "gmail",
    dryRun: false,
    submittedAt: new Date().toISOString(),
    latencyMs,
  };
}
