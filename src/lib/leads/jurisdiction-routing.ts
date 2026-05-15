/**
 * Jurisdiction routing for leads.
 *
 * Single source of truth for "is this state one we serve?" and "which
 * attorney owns it?". Both lists come from firm_config -- never hardcoded
 * here -- so adding a new state or moving an attorney is one config edit.
 *
 * firm_config keys consumed:
 *   jurisdiction_schedule              -> { [state_code]: { state_name, ... } }
 *   attorney_of_record_by_jurisdiction -> { [state_code]: { name, ... } }
 *
 * Used by every lead entry point: createLead form, CSV import,
 * processInboundMessage (SMS/email auto-intake), and the backfill script.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface JurisdictionConfig {
  /** Two-letter codes the firm serves, uppercase. e.g. ["TX","IA","ND","PA","NJ"]. */
  supportedStates: string[];
  /** state_code -> attorney display name. */
  attorneyByState: Record<string, string>;
  /** Lowercase full-state-name -> state_code, for normalizing free-text input. */
  nameToCode: Record<string, string>;
}

export type RoutingDecision = "supported" | "unsupported" | "unknown";

export interface RoutingResult {
  decision: RoutingDecision;
  /** Normalized two-letter state code if we could derive one, else null. */
  normalizedState: string | null;
  /** Attorney display name if supported, else null. */
  assignedAttorneyName: string | null;
}

interface JurisdictionScheduleRow {
  state_code?: string;
  state_name?: string;
}

interface AttorneyEntry {
  name?: string;
}

/**
 * Loads the firm's jurisdiction routing config from firm_config.
 * Throws if either required row is missing -- the call site cannot make a
 * decision without it. CLAUDE.md §7: no inline defaults.
 */
export async function loadJurisdictionConfig(
  admin: SupabaseClient,
  firmId: string,
): Promise<JurisdictionConfig> {
  const { data, error } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", firmId)
    .in("key", ["jurisdiction_schedule", "attorney_of_record_by_jurisdiction"]);

  if (error) {
    throw new Error(`Failed to load jurisdiction config: ${error.message}`);
  }

  const byKey = new Map<string, unknown>();
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    byKey.set(row.key, row.value);
  }

  const schedule = byKey.get("jurisdiction_schedule") as
    | Record<string, JurisdictionScheduleRow>
    | undefined;
  const attorneys = byKey.get("attorney_of_record_by_jurisdiction") as
    | Record<string, AttorneyEntry>
    | undefined;

  if (!schedule) {
    throw new Error(
      "firm_config.jurisdiction_schedule is not set -- run scripts/seed-lfl-engagement-config.ts",
    );
  }
  if (!attorneys) {
    throw new Error(
      "firm_config.attorney_of_record_by_jurisdiction is not set -- run scripts/seed-lfl-engagement-config.ts",
    );
  }

  const supportedStates: string[] = [];
  const nameToCode: Record<string, string> = {};
  for (const [code, row] of Object.entries(schedule)) {
    const upper = code.toUpperCase();
    supportedStates.push(upper);
    if (row.state_name) {
      nameToCode[row.state_name.toLowerCase()] = upper;
    }
    nameToCode[upper.toLowerCase()] = upper;
  }

  const attorneyByState: Record<string, string> = {};
  for (const [code, entry] of Object.entries(attorneys)) {
    if (entry?.name) {
      attorneyByState[code.toUpperCase()] = entry.name;
    }
  }

  return { supportedStates, attorneyByState, nameToCode };
}

/**
 * Normalize a free-text state input to a two-letter code we can route on.
 * Accepts "TX", "tx", "texas", "Texas", with trim.
 * Returns null when input is null/empty or doesn't match a known code/name.
 */
export function normalizeState(
  input: string | null | undefined,
  config: JurisdictionConfig,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Two-letter code path: uppercase and check supported set.
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return config.supportedStates.includes(upper) ? upper : upper;
    // Note: we return the uppercased code even when unsupported so callers
    // can audit-log what the user actually typed (e.g. "CA" -> "CA"). The
    // decision below classifies it as "unsupported".
  }

  // Full-name path: lookup in config.nameToCode.
  const fromName = config.nameToCode[trimmed.toLowerCase()];
  if (fromName) return fromName;

  // No match -- return the input uppercased for traceability; caller will
  // see decision="unsupported".
  return trimmed.toUpperCase();
}

/**
 * Decide what to do with a lead whose state is `rawState`.
 *
 *   - "supported":   state is in firm_config.jurisdiction_schedule.
 *     Insert with state + assignedAttorneyName populated.
 *   - "unsupported": state was provided but not in the supported set.
 *     Caller should refuse to insert (manual/CSV) or drop (auto-intake).
 *   - "unknown":     no state was provided. Caller should insert with
 *     state=null and attorney=null; backfill later when state is known.
 */
export function routeLead(
  rawState: string | null | undefined,
  config: JurisdictionConfig,
): RoutingResult {
  if (!rawState || !rawState.trim()) {
    return { decision: "unknown", normalizedState: null, assignedAttorneyName: null };
  }

  const code = normalizeState(rawState, config);
  if (!code) {
    return { decision: "unknown", normalizedState: null, assignedAttorneyName: null };
  }

  if (!config.supportedStates.includes(code)) {
    return { decision: "unsupported", normalizedState: code, assignedAttorneyName: null };
  }

  return {
    decision: "supported",
    normalizedState: code,
    assignedAttorneyName: config.attorneyByState[code] ?? null,
  };
}

export class UnsupportedJurisdictionError extends Error {
  constructor(public readonly state: string, public readonly supportedStates: string[]) {
    super(
      `State "${state}" is not served. Supported states: ${supportedStates.join(", ")}.`,
    );
    this.name = "UnsupportedJurisdictionError";
  }
}
