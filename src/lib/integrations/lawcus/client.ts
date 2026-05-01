/**
 * Lawcus adapter — stub implementation.
 *
 * The Lawcus API token is currently inactive (returns 401). All real-call
 * functions throw LawcusError. Dry-run functions succeed and can be used
 * for testing the integration wiring.
 *
 * When the token is refreshed, remove the guard throws and uncomment the
 * fetch calls marked with "// LIVE:" below.
 */

import {
  LawcusContactInputSchema,
  LawcusMatterInputSchema,
  type LawcusContactInput,
  type LawcusContactResult,
  type LawcusMatterInput,
  type LawcusMatterResult,
} from "./types";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class LawcusError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LawcusError";
  }
}

// ---------------------------------------------------------------------------
// Guard — throws until token is configured
// ---------------------------------------------------------------------------

function throwNotConfigured(operation: string): never {
  throw new LawcusError(
    `Lawcus ${operation} unavailable: API token not configured. ` +
      `Obtain a fresh token and update the integration_accounts record to enable.`,
  );
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export function createContactDryRun(
  input: LawcusContactInput,
): LawcusContactResult {
  LawcusContactInputSchema.parse(input);
  return {
    id: `dry_run_contact_${Date.now()}`,
    provider: "lawcus",
    dryRun: true,
  };
}

export async function createContact(
  _credentials: Record<string, unknown>,
  _input: LawcusContactInput,
): Promise<LawcusContactResult> {
  // LIVE: Uncomment when token is refreshed
  // const parsedCreds = LawcusCredentialsSchema.parse(credentials);
  // const parsedInput = LawcusContactInputSchema.parse(input);
  // const response = await fetch(`${parsedCreds.baseUrl}/contacts`, { ... });
  throwNotConfigured("createContact");
}

// ---------------------------------------------------------------------------
// Matter
// ---------------------------------------------------------------------------

export function syncMatterDryRun(
  input: LawcusMatterInput,
): LawcusMatterResult {
  LawcusMatterInputSchema.parse(input);
  return {
    id: `dry_run_matter_${Date.now()}`,
    provider: "lawcus",
    dryRun: true,
  };
}

export async function syncMatter(
  _credentials: Record<string, unknown>,
  _input: LawcusMatterInput,
): Promise<LawcusMatterResult> {
  // LIVE: Uncomment when token is refreshed
  // const parsedCreds = LawcusCredentialsSchema.parse(credentials);
  // const parsedInput = LawcusMatterInputSchema.parse(input);
  // const response = await fetch(`${parsedCreds.baseUrl}/matters`, { ... });
  throwNotConfigured("syncMatter");
}
