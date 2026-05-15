/**
 * Confido Legal payments adapter.
 *
 * Pure function: takes credentials + input, returns result. Does NOT write
 * to the database -- caller (engagement/create-invoice-on-signed.ts) handles
 * the invoices row + audit log.
 *
 * The live `createPaymentLink` impl is stubbed: fetch
 * https://confidolegal.com/developer-center before lighting it up so the
 * GraphQL mutation, field names, and webhook signing match Confido's actual
 * schema. Dry-run is fully implemented and used until credentials arrive.
 */

import {
  CreatePaymentLinkInputSchema,
  type CreatePaymentLinkInput,
  type CreatePaymentLinkResult,
  type PaymentsCredentials,
} from "@/lib/adapters/payments";
import { ConfidoCredentialsSchema } from "./types";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ConfidoError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConfidoError";
  }
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export function createPaymentLinkDryRun(
  input: CreatePaymentLinkInput,
): CreatePaymentLinkResult {
  CreatePaymentLinkInputSchema.parse(input);
  const id = `dry_run_${Date.now()}`;
  return {
    providerId: id,
    paymentUrl: `https://dry-run.confido.local/pay/${id}`,
    provider: "confido",
    dryRun: true,
    latencyMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Create payment link (live -- stubbed until Confido docs are fetched)
// ---------------------------------------------------------------------------

export async function createPaymentLink(
  credentials: PaymentsCredentials,
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  ConfidoCredentialsSchema.parse(credentials);
  CreatePaymentLinkInputSchema.parse(input);

  // TODO: implement when Confido docs are fetched + API key provided.
  //   1. POST to credentials.endpoint (or default GraphQL URL from docs)
  //   2. Mutation: createInvoice / createPaymentLink (verify field names)
  //   3. Authorization: Bearer ${credentials.apiKey}
  //   4. Parse response into providerId + paymentUrl
  //   5. Return.
  throw new ConfidoError(
    "Live Confido integration not yet implemented -- run dry-run path until credentials + docs are confirmed",
  );
}
