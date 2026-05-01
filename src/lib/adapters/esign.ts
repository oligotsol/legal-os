/**
 * E-sign adapter contract.
 *
 * Defines the typed interface for creating signature requests and
 * checking their status. Provider implementations (Dropbox Sign, etc.)
 * conform to these function signatures.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateSignatureRequestInputSchema = z.object({
  signerEmail: z.string().email(),
  signerName: z.string().min(1),
  subject: z.string().min(1).max(255),
  message: z.string().optional(),
  title: z.string().min(1),
  /** Document content (plain text or HTML in v1; PDF in v2) */
  documentContent: z.string().min(1),
  /** Opaque reference the caller can use to correlate with engagement_letters */
  externalRef: z.string().optional(),
});

export type CreateSignatureRequestInput = z.infer<typeof CreateSignatureRequestInputSchema>;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic credential bag. Each provider validates its own shape
 * internally using a Zod schema.
 */
export type ESignCredentials = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CreateSignatureRequestResult {
  /** Provider envelope/request ID */
  envelopeId: string;
  /** URL the signer can use to sign (if available) */
  signUrl: string | null;
  /** Provider name (e.g. "dropbox_sign") */
  provider: string;
  /** True when running without credentials / in test mode */
  dryRun: boolean;
  /** Round-trip latency in ms */
  latencyMs: number;
}

export type SignatureStatus =
  | "awaiting_signature"
  | "signed"
  | "declined"
  | "expired";

export interface SignatureStatusResult {
  /** Provider envelope/request ID */
  envelopeId: string;
  /** Current status */
  status: SignatureStatus;
  /** ISO timestamp when signed (null if not yet signed) */
  signedAt: string | null;
}

// ---------------------------------------------------------------------------
// Function types
// ---------------------------------------------------------------------------

export type CreateSignatureRequestFn = (
  credentials: ESignCredentials,
  input: CreateSignatureRequestInput,
) => Promise<CreateSignatureRequestResult>;

export type GetSignatureStatusFn = (
  credentials: ESignCredentials,
  envelopeId: string,
) => Promise<SignatureStatusResult>;
