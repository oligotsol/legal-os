/**
 * Lawcus-specific Zod schemas for credential validation and
 * API input/output types.
 *
 * Note: The Lawcus API token is currently dead (401). These types
 * are defined so the adapter can be flipped to live when a fresh
 * token is obtained.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const LawcusCredentialsSchema = z.object({
  apiToken: z.string().min(1, "Lawcus API token is required"),
  baseUrl: z.string().url().optional().default("https://app.lawcus.com/api"),
});

export type LawcusCredentials = z.infer<typeof LawcusCredentialsSchema>;

// ---------------------------------------------------------------------------
// OAuth (authorization code flow)
// ---------------------------------------------------------------------------

export const LawcusOAuthCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().optional().default("Bearer"),
  scope: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  obtainedAt: z.string().datetime(),
});

export type LawcusOAuthCredentials = z.infer<typeof LawcusOAuthCredentialsSchema>;

export const LawcusTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export type LawcusTokenResponse = z.infer<typeof LawcusTokenResponseSchema>;

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const LawcusContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
    })
    .optional(),
});

export type LawcusContactInput = z.infer<typeof LawcusContactInputSchema>;

export interface LawcusContactResult {
  id: string;
  provider: "lawcus";
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Matter
// ---------------------------------------------------------------------------

export const LawcusMatterInputSchema = z.object({
  contactId: z.string().min(1),
  name: z.string().min(1),
  matterType: z.string().optional(),
  jurisdiction: z.string().optional(),
});

export type LawcusMatterInput = z.infer<typeof LawcusMatterInputSchema>;

export interface LawcusMatterResult {
  id: string;
  provider: "lawcus";
  dryRun: boolean;
}
