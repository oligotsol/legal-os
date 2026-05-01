/**
 * Dropbox Sign (HelloSign) e-sign adapter.
 *
 * Pure function: takes credentials + input, returns result.
 * Does NOT write to the database — caller handles engagement_letters + audit_log.
 */

import {
  CreateSignatureRequestInputSchema,
  type CreateSignatureRequestInput,
  type CreateSignatureRequestResult,
  type ESignCredentials,
  type SignatureStatusResult,
  type SignatureStatus,
} from "@/lib/adapters/esign";
import {
  DropboxSignCredentialsSchema,
  DropboxSignSignatureRequestResponseSchema,
  DropboxSignStatusResponseSchema,
} from "./types";

const HELLOSIGN_BASE_URL = "https://api.hellosign.com/v3";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class DropboxSignError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DropboxSignError";
  }
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export function createSignatureRequestDryRun(
  input: CreateSignatureRequestInput,
): CreateSignatureRequestResult {
  CreateSignatureRequestInputSchema.parse(input);
  return {
    envelopeId: `dry_run_${Date.now()}`,
    signUrl: null,
    provider: "dropbox_sign",
    dryRun: true,
    latencyMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Create signature request
// ---------------------------------------------------------------------------

export async function createSignatureRequest(
  credentials: ESignCredentials,
  input: CreateSignatureRequestInput,
): Promise<CreateSignatureRequestResult> {
  const parsedCreds = DropboxSignCredentialsSchema.parse(credentials);
  const parsedInput = CreateSignatureRequestInputSchema.parse(input);

  const start = performance.now();

  // Build form data for the API
  const formData = new FormData();
  formData.append("title", parsedInput.title);
  formData.append("subject", parsedInput.subject);
  if (parsedInput.message) {
    formData.append("message", parsedInput.message);
  }
  formData.append("signers[0][email_address]", parsedInput.signerEmail);
  formData.append("signers[0][name]", parsedInput.signerName);
  formData.append("test_mode", parsedCreds.testMode ? "1" : "0");

  // Attach document content as a file
  const blob = new Blob([parsedInput.documentContent], { type: "text/plain" });
  formData.append("file[0]", blob, `${parsedInput.title}.txt`);

  if (parsedCreds.clientId) {
    formData.append("client_id", parsedCreds.clientId);
  }

  let response: Response;
  try {
    response = await fetch(`${HELLOSIGN_BASE_URL}/signature_request/send`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(parsedCreds.apiKey + ":")}`,
      },
      body: formData,
    });
  } catch (err) {
    throw new DropboxSignError(
      `Network error calling Dropbox Sign API: ${err instanceof Error ? err.message : String(err)}`,
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
    throw new DropboxSignError(
      `Dropbox Sign API returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = DropboxSignSignatureRequestResponseSchema.parse(json);

  return {
    envelopeId: parsed.signature_request.signature_request_id,
    signUrl: parsed.signature_request.signing_url ?? null,
    provider: "dropbox_sign",
    dryRun: false,
    latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Get signature status
// ---------------------------------------------------------------------------

export async function getSignatureStatus(
  credentials: ESignCredentials,
  envelopeId: string,
): Promise<SignatureStatusResult> {
  const parsedCreds = DropboxSignCredentialsSchema.parse(credentials);

  let response: Response;
  try {
    response = await fetch(`${HELLOSIGN_BASE_URL}/signature_request/${envelopeId}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${btoa(parsedCreds.apiKey + ":")}`,
      },
    });
  } catch (err) {
    throw new DropboxSignError(
      `Network error calling Dropbox Sign API: ${err instanceof Error ? err.message : String(err)}`,
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
    throw new DropboxSignError(
      `Dropbox Sign API returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = DropboxSignStatusResponseSchema.parse(json);
  const req = parsed.signature_request;

  let status: SignatureStatus = "awaiting_signature";
  let signedAt: string | null = null;

  if (req.is_complete) {
    status = "signed";
    const firstSig = req.signatures?.[0];
    if (firstSig?.signed_at) {
      signedAt = new Date(firstSig.signed_at * 1000).toISOString();
    }
  } else if (req.is_declined) {
    status = "declined";
  }

  return {
    envelopeId: req.signature_request_id,
    status,
    signedAt,
  };
}
