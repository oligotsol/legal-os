/**
 * Shared credential helper for integration accounts.
 *
 * Fetches credentials from the integration_accounts table via the admin
 * (service-role) client. Callers pass the result to adapter functions.
 *
 * Encryption at rest is handled at the DB / KMS layer — this module returns
 * the decrypted JSONB as-is. A future change will add application-level
 * envelope decryption here as a single-point change.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { IntegrationAccount, IntegrationProvider } from "@/types/database";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class IntegrationCredentialsError extends Error {
  constructor(
    message: string,
    public readonly provider: IntegrationProvider,
    public readonly firmId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IntegrationCredentialsError";
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface IntegrationAccountResult {
  account: IntegrationAccount;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the integration account for a firm + provider pair.
 *
 * Uses the service-role client (bypasses RLS) — only call from server-side
 * code paths where the caller has already verified the user belongs to the firm.
 */
export async function getIntegrationAccount(
  firmId: string,
  provider: IntegrationProvider,
): Promise<IntegrationAccountResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("firm_id", firmId)
    .eq("provider", provider)
    .single();

  if (error || !data) {
    throw new IntegrationCredentialsError(
      `No integration account found for provider "${provider}"`,
      provider,
      firmId,
      error,
    );
  }

  return {
    account: data as IntegrationAccount,
    isActive: data.status === "active",
  };
}
