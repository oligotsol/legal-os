/**
 * Initiates the Lawcus OAuth authorization flow for the caller's firm.
 *
 * Requires an authenticated session — the firm_id is read from the user's
 * firm membership, never from the query string.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildAuthorizeUrl,
  LawcusOAuthError,
  readOAuthEnv,
} from "@/lib/integrations/lawcus/oauth";

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
    if (err instanceof LawcusOAuthError) {
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
