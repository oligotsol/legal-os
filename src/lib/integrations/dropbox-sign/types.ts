/**
 * Dropbox Sign (HelloSign) Zod schemas for credential validation,
 * API response parsing, and inbound webhook payloads.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const DropboxSignCredentialsSchema = z.object({
  apiKey: z.string().min(1, "Dropbox Sign API key is required"),
  clientId: z.string().optional(),
  testMode: z.boolean().optional().default(false),
});

export type DropboxSignCredentials = z.infer<typeof DropboxSignCredentialsSchema>;

// ---------------------------------------------------------------------------
// API response — create signature request
// ---------------------------------------------------------------------------

export const DropboxSignSignatureRequestResponseSchema = z.object({
  signature_request: z.object({
    signature_request_id: z.string(),
    signing_url: z.string().nullable().optional(),
    is_complete: z.boolean().optional(),
  }),
});

export type DropboxSignSignatureRequestResponse = z.infer<
  typeof DropboxSignSignatureRequestResponseSchema
>;

// ---------------------------------------------------------------------------
// API response — get signature request status
// ---------------------------------------------------------------------------

export const DropboxSignStatusResponseSchema = z.object({
  signature_request: z.object({
    signature_request_id: z.string(),
    is_complete: z.boolean(),
    is_declined: z.boolean().optional(),
    has_error: z.boolean().optional(),
    signatures: z.array(
      z.object({
        status_code: z.string(),
        signed_at: z.number().nullable().optional(),
      }),
    ).optional(),
  }),
});

export type DropboxSignStatusResponse = z.infer<typeof DropboxSignStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Webhook event
// ---------------------------------------------------------------------------

export const DropboxSignWebhookEventSchema = z.object({
  event: z.object({
    event_type: z.string(),
    event_time: z.string().optional(),
    event_metadata: z.object({
      related_signature_id: z.string().optional(),
      reported_for_account_id: z.string().optional(),
    }).optional(),
  }),
  signature_request: z.object({
    signature_request_id: z.string(),
    is_complete: z.boolean().optional(),
  }).optional(),
});

export type DropboxSignWebhookEvent = z.infer<typeof DropboxSignWebhookEventSchema>;
