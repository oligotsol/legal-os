/**
 * backfill-lead-jurisdictions.ts -- one-off
 *
 * For each firm:
 *   1. Load supported states + attorney map from firm_config (no hardcoded list).
 *   2. For every lead joined to its contact:
 *      - Derive state from leads.state, falling back to contacts.state.
 *      - If state is in supported set -> populate leads.state + leads.assigned_attorney_name.
 *      - If state is set and outside supported set -> hard-delete the lead row
 *        AND the contact (CLAUDE.md §8 says customer data is soft-delete only,
 *        but the brief explicitly asks for hard-delete on unsupported jurisdictions
 *        as a one-off cleanup before going live -- this script is dev-side,
 *        not the product surface).
 *      - If state is null -> leave the row alone; it'll get filled in when the
 *        conversation flow discovers state.
 *
 * Usage:
 *   npx tsx scripts/backfill-lead-jurisdictions.ts                # dry run, prints plan
 *   npx tsx scripts/backfill-lead-jurisdictions.ts --apply        # actually writes
 *   npx tsx scripts/backfill-lead-jurisdictions.ts --apply --firm <uuid>
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  loadJurisdictionConfig,
  routeLead,
} from "../src/lib/leads/jurisdiction-routing";

config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const firmArgIndex = process.argv.indexOf("--firm");
const targetFirmId = firmArgIndex > -1 ? process.argv[firmArgIndex + 1] : null;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

async function main() {
  // Discover firms
  let firmsQuery = admin.from("firms").select("id, name");
  if (targetFirmId) firmsQuery = firmsQuery.eq("id", targetFirmId);
  const { data: firms, error: firmsErr } = await firmsQuery;
  if (firmsErr) {
    console.error(`Failed to load firms: ${firmsErr.message}`);
    process.exit(1);
  }

  for (const firm of firms ?? []) {
    console.log(`\n== firm ${firm.name} (${firm.id}) ==`);

    let configLoaded;
    try {
      configLoaded = await loadJurisdictionConfig(admin, firm.id);
    } catch (err) {
      console.warn(
        `  skipping: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    console.log(
      `  supported states: ${configLoaded.supportedStates.join(", ")}`,
    );

    const { data: leads, error: leadsErr } = await admin
      .from("leads")
      .select("id, state, assigned_attorney_name, contact_id, contacts(state)")
      .eq("firm_id", firm.id);
    if (leadsErr) {
      console.warn(`  failed to load leads: ${leadsErr.message}`);
      continue;
    }

    let updated = 0;
    let deletedLeads = 0;
    let deletedContacts = 0;
    let untouched = 0;

    for (const lead of leads ?? []) {
      const contactRaw = (lead as { contacts?: unknown }).contacts;
      const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as
        | { state?: string | null }
        | null;
      const rawState = lead.state ?? contact?.state ?? null;
      const routing = routeLead(rawState, configLoaded);

      if (routing.decision === "supported") {
        // Skip if already correctly set
        if (
          lead.state === routing.normalizedState &&
          lead.assigned_attorney_name === routing.assignedAttorneyName
        ) {
          untouched++;
          continue;
        }
        if (apply) {
          const { error } = await admin
            .from("leads")
            .update({
              state: routing.normalizedState,
              assigned_attorney_name: routing.assignedAttorneyName,
            })
            .eq("id", lead.id);
          if (error) {
            console.warn(`  update failed for lead ${lead.id}: ${error.message}`);
            continue;
          }
        }
        updated++;
      } else if (routing.decision === "unsupported") {
        if (apply) {
          // Hard-delete: the brief asks for full removal of out-of-jurisdiction
          // data before LFL goes live. Contact deletion CASCADEs the lead via
          // FK ... actually leads.contact_id is ON DELETE SET NULL, so order:
          // delete lead first, then contact.
          await admin.from("leads").delete().eq("id", lead.id);
          if (lead.contact_id) {
            await admin.from("contacts").delete().eq("id", lead.contact_id);
            deletedContacts++;
          }
        }
        deletedLeads++;
      } else {
        untouched++;
      }
    }

    console.log(
      `  ${apply ? "applied" : "would apply"}: ${updated} updated, ${deletedLeads} leads deleted (${deletedContacts} contacts deleted), ${untouched} untouched`,
    );
  }

  if (!apply) {
    console.log("\nDry run -- pass --apply to write changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
