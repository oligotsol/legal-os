/**
 * Gmail OAuth callback. Receives the authorization code, exchanges it
 * for tokens, persists them in integration_accounts (scoped to the
 * firm encoded in the signed state), and audit-logs the connection.
 *
 * Refuses to flip status='active' if the token response lacks a
 * refresh_token — without one, dispatch breaks again on the next
 * access token expiry. Re-running with prompt=consent always returns
 * a refresh_token, so absence indicates a misconfiguration.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForToken,
  GmailOAuthError,
  readOAuthEnv,
  verifyState,
} from "@/lib/integrations/gmail/oauth";
import type { GmailCredentials } from "@/lib/integrations/gmail/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return NextResponse.json(
      {
        error: "Gmail authorization denied",
        provider_error: error,
        description: errorDescription,
      },
      { status: 400 },
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing required parameters: code and state" },
      { status: 400 },
    );
  }

  let env;
  try {
    env = readOAuthEnv();
  } catch (err) {
    if (err instanceof GmailOAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode ?? 503 },
      );
    }
    throw err;
  }

  let firmId: string;
  try {
    ({ firmId } = verifyState(state, env.stateSecret));
  } catch (err) {
    if (err instanceof GmailOAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode ?? 400 },
      );
    }
    throw err;
  }

  let token;
  try {
    token = await exchangeCodeForToken(env, code);
  } catch (err) {
    if (err instanceof GmailOAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode ?? 502 },
      );
    }
    throw err;
  }

  if (!token.refresh_token) {
    return NextResponse.json(
      {
        error:
          "No refresh_token returned. Revoke the app at https://myaccount.google.com/permissions and retry — Google only returns a refresh token on first consent.",
      },
      { status: 400 },
    );
  }

  const credentials: GmailCredentials = {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: token.refresh_token,
  };

  const admin = createAdminClient();

  const { error: upsertError } = await admin
    .from("integration_accounts")
    .upsert(
      {
        firm_id: firmId,
        provider: "gmail",
        credentials: credentials as unknown as Record<string, unknown>,
        status: "active",
        config: { auth: "oauth2", scopes: env.scopes, granted_scope: token.scope ?? null },
      },
      { onConflict: "firm_id,provider" },
    );

  if (upsertError) {
    return NextResponse.json(
      {
        error: "Failed to persist Gmail credentials",
        details: upsertError.message,
      },
      { status: 500 },
    );
  }

  await admin.from("audit_log").insert({
    firm_id: firmId,
    action: "integration.gmail.connected",
    entity_type: "integration_account",
    entity_id: null,
    metadata: { scope: token.scope ?? null, has_refresh_token: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  return NextResponse.redirect(
    `${appUrl}/dashboard?integration=gmail&status=connected`,
    302,
  );
}
