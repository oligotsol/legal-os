/**
 * Dialpad-specific Zod schemas for credential validation,
 * API response parsing, and inbound webhook payloads.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const DialpadCredentialsSchema = z.object({
  apiKey: z.string().min(1, "Dialpad API key is required"),
  webhookSecret: z.string().optional(),
});

export type DialpadCredentials = z.infer<typeof DialpadCredentialsSchema>;

// ---------------------------------------------------------------------------
// SMS send response — POST /v2/sms
// ---------------------------------------------------------------------------

export const DialpadSmsResponseSchema = z.object({
  request_id: z.string(),
  /** Dialpad may include additional fields; we only require request_id */
});

export type DialpadSmsResponse = z.infer<typeof DialpadSmsResponseSchema>;

// ---------------------------------------------------------------------------
// Inbound SMS webhook payload
// ---------------------------------------------------------------------------

export const DialpadInboundSmsSchema = z.object({
  id: z.number(),
  created_date: z.number(),
  direction: z.literal("inbound"),
  event_timestamp: z.number().optional(),
  target: z.object({
    id: z.number(),
    type: z.string(),
    phone_number: z.string().optional(),
    phone: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    office_id: z.number().optional(),
  }),
  contact: z.object({
    id: z.union([z.string(), z.number()]),
    type: z.string().optional(),
    phone_number: z.string().optional(),
    phone: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  }),
  from_number: z.string(),
  to_number: z.array(z.string()),
  mms: z.boolean(),
  is_internal: z.boolean().optional(),
  sender_id: z.number().nullable().optional(),
  text: z.string().optional(),
  message_status: z.string().optional(),
  message_delivery_result: z.string().nullable().optional(),
});

export type DialpadInboundSms = z.infer<typeof DialpadInboundSmsSchema>;
