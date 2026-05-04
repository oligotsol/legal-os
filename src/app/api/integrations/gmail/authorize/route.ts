/**
 * Initiates the Gmail OAuth authorization flow for the caller's firm.
 * Redirects to Google's consent screen with offline access + forced
 * consent so a refresh_token is returned even on subsequent runs.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildAuthorizeUrl,
  GmailOAuthError,
  readOAuthEnv,
} from "@/lib/integrations/gmail/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    return NextResponse.json(
      { error: "No firm membership found for user" },
      { status: 403 },
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

  const url = buildAuthorizeUrl(env, membership.firm_id);
  return NextResponse.redirect(url, 302);
}
