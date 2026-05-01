/**
 * Postmark email adapter — sends email via POST /email.
 *
 * Pure function: takes credentials + input, returns result.
 * Does NOT write to the database — caller handles messages table + audit_log.
 */

import {
  SendEmailInputSchema,
  type SendEmailInput,
  type SendEmailResult,
  type EmailCredentials,
} from "@/lib/adapters/email";
import { PostmarkCredentialsSchema, PostmarkSendResponseSchema } from "./types";

const POSTMARK_BASE_URL = "https://api.postmarkapp.com";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PostmarkEmailError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: number,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PostmarkEmailError";
  }
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export function sendEmailDryRun(input: SendEmailInput): SendEmailResult {
  const parsed = SendEmailInputSchema.parse(input);
  return {
    messageId: `dry_run_${Date.now()}`,
    provider: "postmark",
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
  const parsedCreds = PostmarkCredentialsSchema.parse(credentials);
  const parsedInput = SendEmailInputSchema.parse(input);

  const body: Record<string, unknown> = {
    From: parsedInput.from,
    To: parsedInput.to,
    Subject: parsedInput.subject,
  };

  if (parsedInput.htmlBody) body.HtmlBody = parsedInput.htmlBody;
  if (parsedInput.textBody) body.TextBody = parsedInput.textBody;
  if (parsedInput.replyTo) body.ReplyTo = parsedInput.replyTo;
  if (parsedInput.tag) body.Tag = parsedInput.tag;
  if (parsedInput.metadata) body.Metadata = parsedInput.metadata;

  const start = performance.now();

  let response: Response;
  try {
    response = await fetch(`${POSTMARK_BASE_URL}/email`, {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": parsedCreds.serverToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new PostmarkEmailError(
      `Network error calling Postmark API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      err,
    );
  }

  const latencyMs = Math.round(performance.now() - start);
  const json = await response.json();

  if (!response.ok) {
    const errorCode = typeof json?.ErrorCode === "number" ? json.ErrorCode : undefined;
    throw new PostmarkEmailError(
      `Postmark API returned ${response.status}: ${json?.Message ?? "(no message)"}`,
      errorCode,
      response.status,
    );
  }

  const parsed = PostmarkSendResponseSchema.parse(json);

  if (parsed.ErrorCode !== 0) {
    throw new PostmarkEmailError(
      `Postmark error ${parsed.ErrorCode}: ${parsed.Message}`,
      parsed.ErrorCode,
    );
  }

  return {
    messageId: parsed.MessageID,
    provider: "postmark",
    dryRun: false,
    submittedAt: parsed.SubmittedAt,
    latencyMs,
  };
}
