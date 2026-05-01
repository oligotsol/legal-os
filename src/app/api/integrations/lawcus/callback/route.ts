/**
 * Lawcus OAuth callback.
 *
 * Public URL registered with Lawcus as the redirect_uri. Receives an
 * authorization code, exchanges it for an access token, stores the token
 * in integration_accounts (scoped to the firm encoded in the signed state),
 * and writes an audit_log entry.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForToken,
  LawcusOAuthError,
  readOAuthEnv,
  verifyState,
} from "@/lib/integrations/lawcus/oauth";
import type { LawcusOAuthCredentials } from "@/lib/integrations/lawcus/types";

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
        error: "Lawcus authorization denied",
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
    if (err instanceof LawcusOAuthError) {
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
    if (err instanceof LawcusOAuthError) {
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
    if (err instanceof LawcusOAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode ?? 502 },
      );
    }
    throw err;
  }

  const obtainedAt = new Date();
  const expiresAt =
    token.expires_in !== undefined
      ? new Date(obtainedAt.getTime() + token.expires_in * 1000)
      : undefined;

  const credentials: LawcusOAuthCredentials = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type ?? "Bearer",
    scope: token.scope,
    obtainedAt: obtainedAt.toISOString(),
    expiresAt: expiresAt?.toISOString(),
  };

  const admin = createAdminClient();

  const { error: upsertError } = await admin
    .from("integration_accounts")
    .upsert(
      {
        firm_id: firmId,
        provider: "lawcus",
        credentials: credentials as unknown as Record<string, unknown>,
        status: "active",
        config: { auth: "oauth2" },
      },
      { onConflict: "firm_id,provider" },
    );

  if (upsertError) {
    return NextResponse.json(
      {
        error: "Failed to persist Lawcus credentials",
        details: upsertError.message,
      },
      { status: 500 },
    );
  }

  await admin.from("audit_log").insert({
    firm_id: firmId,
    action: "integration.lawcus.connected",
    entity_type: "integration_account",
    entity_id: null,
    metadata: { scope: token.scope ?? null, has_refresh_token: !!token.refresh_token },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  return NextResponse.redirect(
    `${appUrl}/dashboard?integration=lawcus&status=connected`,
    302,
  );
}
