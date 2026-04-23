import { createClient } from "@supabase/supabase-js";

/**
 * Service role client for admin operations (seed scripts, audit log inserts,
 * firm/user management). Never import this in client components or expose
 * the service role key via NEXT_PUBLIC_*.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
