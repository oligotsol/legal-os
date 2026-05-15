/**
 * Gmail OAuth 2.0 authorization code flow.
 *
 * Standard OAuth 2.0 authorization-code flow. We need `access_type=offline` and
 * `prompt=consent` on the authorize URL so Google issues a refresh
 * token (otherwise re-consent only returns an access token).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { GmailTokenResponseSchema } from "./types";
import { z } from "zod";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Default scopes — send + read. Extend as features need it. */
const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export class GmailOAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GmailOAuthError";
  }
}

export interface GmailOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
  scopes: string[];
}

export function readOAuthEnv(): GmailOAuthEnv {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  const stateSecret = process.env.GMAIL_OAUTH_STATE_SECRET;
  const scopesEnv = process.env.GMAIL_OAUTH_SCOPES;

  const missing: string[] = [];
  if (!clientId) missing.push("GMAIL_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GMAIL_OAUTH_CLIENT_SECRET");
  if (!redirectUri) missing.push("GMAIL_OAUTH_REDIRECT_URI");
  if (!stateSecret) missing.push("GMAIL_OAUTH_STATE_SECRET");

  if (missing.length > 0) {
    throw new GmailOAuthError(
      `Gmail OAuth not configured: missing ${missing.join(", ")}`,
      503,
    );
  }

  const scopes = scopesEnv
    ? scopesEnv.split(/[\s,]+/).filter(Boolean)
    : DEFAULT_SCOPES;

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    stateSecret: stateSecret!,
    scopes,
  };
}

export function signState(firmId: string, secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${firmId}.${nonce}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state: string, secret: string): { firmId: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new GmailOAuthError("Invalid state encoding", 400);
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) {
    throw new GmailOAuthError("Invalid state shape", 400);
  }
  const [firmId, nonce, sig] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${firmId}.${nonce}`)
    .digest("hex");

  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new GmailOAuthError("State signature mismatch", 400);
  }

  return { firmId };
}

export function buildAuthorizeUrl(env: GmailOAuthEnv, firmId: string): string {
  const state = signState(firmId, env.stateSecret);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    scope: env.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

const TokenExchangeSchema = GmailTokenResponseSchema.extend({
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export async function exchangeCodeForToken(
  env: GmailOAuthEnv,
  code: string,
): Promise<z.infer<typeof TokenExchangeSchema>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectUri,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new GmailOAuthError(
      `Token exchange failed (${response.status}): ${text.slice(0, 500)}`,
      response.status,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new GmailOAuthError("Token endpoint returned non-JSON", 502, cause);
  }

  const parsed = TokenExchangeSchema.safeParse(json);
  if (!parsed.success) {
    throw new GmailOAuthError(
      `Token response failed validation: ${parsed.error.message}`,
      502,
    );
  }
  return parsed.data;
}
