/**
 * Lawcus OAuth 2.0 authorization code flow.
 *
 * Endpoints, client_id, and client_secret are populated from env when
 * Lawcus provisions API access. Until then, the flow short-circuits with
 * a 503 at runtime.
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { LawcusTokenResponseSchema, type LawcusTokenResponse } from "./types";

export class LawcusOAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LawcusOAuthError";
  }
}

export interface LawcusOAuthEnv {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  stateSecret: string;
}

export function readOAuthEnv(): LawcusOAuthEnv {
  const clientId = process.env.LAWCUS_CLIENT_ID;
  const clientSecret = process.env.LAWCUS_CLIENT_SECRET;
  const authorizeUrl = process.env.LAWCUS_OAUTH_AUTHORIZE_URL;
  const tokenUrl = process.env.LAWCUS_OAUTH_TOKEN_URL;
  const redirectUri = process.env.LAWCUS_OAUTH_REDIRECT_URI;
  const stateSecret = process.env.LAWCUS_OAUTH_STATE_SECRET;

  const missing: string[] = [];
  if (!clientId) missing.push("LAWCUS_CLIENT_ID");
  if (!clientSecret) missing.push("LAWCUS_CLIENT_SECRET");
  if (!authorizeUrl) missing.push("LAWCUS_OAUTH_AUTHORIZE_URL");
  if (!tokenUrl) missing.push("LAWCUS_OAUTH_TOKEN_URL");
  if (!redirectUri) missing.push("LAWCUS_OAUTH_REDIRECT_URI");
  if (!stateSecret) missing.push("LAWCUS_OAUTH_STATE_SECRET");

  if (missing.length > 0) {
    throw new LawcusOAuthError(
      `Lawcus OAuth not configured: missing ${missing.join(", ")}`,
      503,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    authorizeUrl: authorizeUrl!,
    tokenUrl: tokenUrl!,
    redirectUri: redirectUri!,
    stateSecret: stateSecret!,
  };
}

// state = base64url(firmId.nonce.hmac(firmId.nonce))
// HMAC binds the firm to a server-issued nonce so a forged callback can't
// pin a token to the wrong firm.
export function signState(firmId: string, secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${firmId}.${nonce}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(
  state: string,
  secret: string,
): { firmId: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new LawcusOAuthError("Invalid state encoding", 400);
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) {
    throw new LawcusOAuthError("Invalid state shape", 400);
  }
  const [firmId, nonce, sig] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${firmId}.${nonce}`)
    .digest("hex");

  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new LawcusOAuthError("State signature mismatch", 400);
  }

  return { firmId };
}

export function buildAuthorizeUrl(
  env: LawcusOAuthEnv,
  firmId: string,
): string {
  const state = signState(firmId, env.stateSecret);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    state,
  });
  return `${env.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  env: LawcusOAuthEnv,
  code: string,
): Promise<LawcusTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectUri,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const response = await fetch(env.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new LawcusOAuthError(
      `Token exchange failed (${response.status}): ${text.slice(0, 500)}`,
      response.status,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new LawcusOAuthError("Token endpoint returned non-JSON", 502, cause);
  }

  const parsed = LawcusTokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new LawcusOAuthError(
      `Token response failed validation: ${parsed.error.message}`,
      502,
    );
  }
  return parsed.data;
}
