/**
 * Payments adapter contract.
 *
 * Defines the typed interface for creating payment links / charges and
 * checking their status. Provider implementations (Confido Legal, etc.)
 * conform to these function signatures.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreatePaymentLinkInputSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  description: z.string().min(1),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  /** Opaque reference the caller can use to correlate with invoices */
  externalRef: z.string().optional(),
  /** Optional URL the payer is redirected to after a successful payment. */
  successUrl: z.string().url().optional(),
});

export type CreatePaymentLinkInput = z.infer<typeof CreatePaymentLinkInputSchema>;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export type PaymentsCredentials = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CreatePaymentLinkResult {
  /** Provider-side invoice / charge / link ID */
  providerId: string;
  /** URL the client clicks to pay */
  paymentUrl: string;
  /** Provider name (e.g. "confido") */
  provider: string;
  /** True when running without credentials / in test mode */
  dryRun: boolean;
  /** Round-trip latency in ms */
  latencyMs: number;
}

export type PaymentStatus = "pending" | "paid" | "refunded" | "cancelled";

export interface PaymentStatusResult {
  providerId: string;
  status: PaymentStatus;
  paidAt: string | null;
}

// ---------------------------------------------------------------------------
// Function types
// ---------------------------------------------------------------------------

export type CreatePaymentLinkFn = (
  credentials: PaymentsCredentials,
  input: CreatePaymentLinkInput,
) => Promise<CreatePaymentLinkResult>;

export type GetPaymentStatusFn = (
  credentials: PaymentsCredentials,
  providerId: string,
) => Promise<PaymentStatusResult>;
