/**
 * Gmail-specific Zod schemas for credential validation,
 * OAuth2 token exchange, and API response parsing.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const GmailCredentialsSchema = z.object({
  clientId: z.string().min(1, "Gmail OAuth client ID is required"),
  clientSecret: z.string().min(1, "Gmail OAuth client secret is required"),
  refreshToken: z.string().min(1, "Gmail OAuth refresh token is required"),
});

export type GmailCredentials = z.infer<typeof GmailCredentialsSchema>;

// ---------------------------------------------------------------------------
// OAuth2 token response
// ---------------------------------------------------------------------------

export const GmailTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

export type GmailTokenResponse = z.infer<typeof GmailTokenResponseSchema>;

// ---------------------------------------------------------------------------
// Send response — POST /gmail/v1/users/me/messages/send
// ---------------------------------------------------------------------------

export const GmailSendResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

export type GmailSendResponse = z.infer<typeof GmailSendResponseSchema>;
