/**
 * Postmark-specific Zod schemas for credential validation,
 * API response parsing, and webhook payloads.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const PostmarkCredentialsSchema = z.object({
  serverToken: z.string().min(1, "Postmark server token is required"),
});

export type PostmarkCredentials = z.infer<typeof PostmarkCredentialsSchema>;

// ---------------------------------------------------------------------------
// Send response — POST /email
// ---------------------------------------------------------------------------

export const PostmarkSendResponseSchema = z.object({
  To: z.string(),
  SubmittedAt: z.string(),
  MessageID: z.string(),
  ErrorCode: z.number(),
  Message: z.string(),
});

export type PostmarkSendResponse = z.infer<typeof PostmarkSendResponseSchema>;

// ---------------------------------------------------------------------------
// Bounce webhook payload
// ---------------------------------------------------------------------------

export const PostmarkBounceWebhookSchema = z.object({
  RecordType: z.literal("Bounce"),
  MessageID: z.string(),
  Type: z.string(),
  TypeCode: z.number(),
  Email: z.string(),
  BouncedAt: z.string(),
  Description: z.string().optional(),
});

export type PostmarkBounceWebhook = z.infer<typeof PostmarkBounceWebhookSchema>;

// ---------------------------------------------------------------------------
// Delivery webhook payload
// ---------------------------------------------------------------------------

export const PostmarkDeliveryWebhookSchema = z.object({
  RecordType: z.literal("Delivery"),
  MessageID: z.string(),
  DeliveredAt: z.string(),
  Recipient: z.string(),
});

export type PostmarkDeliveryWebhook = z.infer<typeof PostmarkDeliveryWebhookSchema>;

// ---------------------------------------------------------------------------
// Inbound webhook payload
// Postmark Inbound JSON: see https://postmarkapp.com/developer/webhooks/inbound-webhook
// ---------------------------------------------------------------------------

export const PostmarkInboundWebhookSchema = z.object({
  RecordType: z.literal("Inbound").optional(),
  MessageID: z.string(),
  From: z.string(),
  FromFull: z
    .object({
      Email: z.string(),
      Name: z.string().optional(),
    })
    .optional(),
  FromName: z.string().optional(),
  To: z.string().optional(),
  Subject: z.string().optional().default(""),
  TextBody: z.string().optional().default(""),
  HtmlBody: z.string().optional().default(""),
  Date: z.string().optional(),
  MessageStream: z.string().optional(),
});

export type PostmarkInboundWebhook = z.infer<
  typeof PostmarkInboundWebhookSchema
>;
