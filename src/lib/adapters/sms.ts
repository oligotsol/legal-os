/**
 * SMS adapter contract.
 *
 * Defines the typed interface for sending SMS. Provider implementations
 * (Dialpad, etc.) conform to the SendSmsFn signature.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const SendSmsInputSchema = z.object({
  to: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone number must be E.164 format"),
  from: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone number must be E.164 format"),
  body: z.string().min(1).max(1600),
  /** Opaque reference the caller can use to correlate with messages table */
  externalRef: z.string().optional(),
});

export type SendSmsInput = z.infer<typeof SendSmsInputSchema>;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface SmsCredentials {
  apiKey: string;
  /** Provider-specific extras (e.g. Dialpad webhook secret) */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface SendSmsResult {
  /** Provider message ID */
  messageId: string;
  /** Provider name (e.g. "dialpad") */
  provider: string;
  /** True when running without credentials / in test mode */
  dryRun: boolean;
  /** ISO timestamp of when the provider accepted the message */
  acceptedAt: string;
  /** Round-trip latency in ms */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Function type
// ---------------------------------------------------------------------------

export type SendSmsFn = (
  credentials: SmsCredentials,
  input: SendSmsInput,
) => Promise<SendSmsResult>;
