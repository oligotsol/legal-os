/**
 * Email adapter contract.
 *
 * Defines the typed interface for sending email. Provider implementations
 * (Postmark, etc.) conform to the SendEmailFn signature.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const SendEmailInputSchema = z
  .object({
    to: z.string().email(),
    from: z.string().email(),
    subject: z.string().min(1).max(998),
    htmlBody: z.string().optional(),
    textBody: z.string().optional(),
    replyTo: z.string().email().optional(),
    /** Message-Stream or equivalent tag for the provider */
    tag: z.string().optional(),
    /** Opaque reference the caller can use to correlate with messages table */
    externalRef: z.string().optional(),
    /** Arbitrary key/value metadata the provider may store/return */
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (d) => d.htmlBody || d.textBody,
    "At least one of htmlBody or textBody must be provided",
  );

export type SendEmailInput = z.infer<typeof SendEmailInputSchema>;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic credential bag. Each provider validates its own shape
 * internally using a Zod schema (e.g. PostmarkCredentialsSchema, GmailCredentialsSchema).
 */
export type EmailCredentials = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface SendEmailResult {
  /** Provider message ID */
  messageId: string;
  /** Provider name (e.g. "postmark") */
  provider: string;
  /** True when running without credentials / in test mode */
  dryRun: boolean;
  /** "Sent", "Queued", etc. */
  submittedAt: string;
  /** Round-trip latency in ms */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Function type
// ---------------------------------------------------------------------------

export type SendEmailFn = (
  credentials: EmailCredentials,
  input: SendEmailInput,
) => Promise<SendEmailResult>;
