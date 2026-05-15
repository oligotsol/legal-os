/**
 * Import Firm Pilot list from Garrison's Google Sheet (CSV export).
 *
 * Headers: full_name, phone, state, timezone, date
 * No emails. Dedup by phone within firm.
 *
 *   npx tsx scripts/import-firm-pilot.ts <csv-path>
 *
 * Stamps each lead with source='csv', payload.list_name='Firm Pilot',
 * payload.timezone, payload.imported_from='google_sheets'. Runs the lead
 * summarizer inline so each gets a concise table description.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { createAdminClient } from "../src/lib/supabase/admin";
import { summarizeLeadDescription } from "../src/lib/ai/summarize-lead";
import { generateLeadDialerAssets } from "../src/lib/pipeline/generate-lead-dialer-assets";

const CSV_PATH = process.argv[2];
const LIST_NAME = "Firm Pilot";
const FIRM_ID = "00000000-0000-0000-0000-000000000001";

if (!CSV_PATH) {
  console.error("usage: npx tsx scripts/import-firm-pilot.ts <csv-path>");
  process.exit(1);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"' && cur === "") inQ = true;
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8) return `+${digits}`;
  return null;
}

function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function main() {
  console.log(`Reading ${CSV_PATH}`);
  const raw = readFileSync(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  console.log(`Parsed ${lines.length - 1} data rows. List: "${LIST_NAME}"`);

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const idx = {
    name: headers.findIndex((h) => h === "full_name" || h === "name"),
    phone: headers.findIndex((h) => h === "phone"),
    state: headers.findIndex((h) => h === "state"),
    timezone: headers.findIndex((h) => h === "timezone" || h === "tz"),
    date: headers.findIndex((h) => h.includes("date") || h.includes("2026")),
  };

  const admin = createAdminClient();
  let imported = 0;
  let dupSkipped = 0;
  let noIdent = 0;
  let failed = 0;
  let totalCostCents = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const name = idx.name >= 0 ? cells[idx.name]?.trim() ?? "" : "";
    const phoneRaw = idx.phone >= 0 ? cells[idx.phone] ?? "" : "";
    const phone = normalizePhone(phoneRaw);
    const state = idx.state >= 0 ? cells[idx.state]?.trim() ?? null : null;
    const timezone = idx.timezone >= 0 ? cells[idx.timezone]?.trim() ?? null : null;
    const dateStr = idx.date >= 0 ? cells[idx.date] ?? "" : "";
    const createdAt = parseDate(dateStr);

    if (!phone) {
      noIdent++;
      continue;
    }

    // Dedup by phone within firm.
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("firm_id", FIRM_ID)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    if (existing) {
      dupSkipped++;
      continue;
    }

    const fullName = name || phone;

    try {
      const { data: contact, error: cErr } = await admin
        .from("contacts")
        .insert({
          firm_id: FIRM_ID,
          full_name: fullName,
          phone,
          state,
          dnc: false,
        })
        .select("id")
        .single();
      if (cErr || !contact) {
        failed++;
        console.error(`  row ${i}: contact insert failed:`, cErr?.message);
        continue;
      }

      let descriptionSummary: string | null = null;
      try {
        const s = await summarizeLeadDescription({
          matterType: null,
          clientDescription: null,
          state,
          recentMessages: [],
          source: "csv",
          channel: null,
        });
        descriptionSummary = s.description;
        totalCostCents += s.costCents;

        if (s.inputTokens > 0) {
          await admin.from("ai_jobs").insert({
            firm_id: FIRM_ID,
            model: s.model,
            purpose: "summarize_lead",
            entity_type: "lead",
            entity_id: null,
            input_tokens: s.inputTokens,
            output_tokens: s.outputTokens,
            cost_cents: s.costCents,
            latency_ms: s.latencyMs,
            status: "completed",
            request_metadata: { source: "csv", list_name: LIST_NAME, backfill: true },
            privileged: false,
          });
        }
      } catch {
        /* non-fatal; placeholder summary */
      }

      const payload: Record<string, unknown> = {
        list_name: LIST_NAME,
        original_source: "Firm Pilot",
        imported_from: "google_sheets",
      };
      if (timezone) payload.timezone = timezone;
      if (descriptionSummary) payload.description_summary = descriptionSummary;

      const { data: lead, error: lErr } = await admin
        .from("leads")
        .insert({
          firm_id: FIRM_ID,
          source: "csv",
          status: "new",
          channel: "manual",
          full_name: fullName,
          phone,
          contact_id: contact.id,
          payload,
          priority: 5,
          created_at: createdAt ?? undefined,
        })
        .select("id")
        .single();
      if (lErr || !lead) {
        failed++;
        console.error(`  row ${i}: lead insert failed:`, lErr?.message);
        continue;
      }

      await admin
        .from("contacts")
        .update({ source_lead_id: lead.id })
        .eq("id", contact.id);

      // Generate the dialer call script + background brief inline so this
      // lead is ready to dial the moment the import completes.
      await generateLeadDialerAssets({
        admin,
        firmId: FIRM_ID,
        leadId: lead.id,
      });

      imported++;
      if (imported % 50 === 0) {
        console.log(`  ${imported} imported (${dupSkipped} dup, ${noIdent} no-phone)`);
      }
    } catch (err) {
      failed++;
      console.error(
        `  row ${i}: unhandled:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(
    `\nDone. imported=${imported} duplicate=${dupSkipped} no_phone=${noIdent} failed=${failed} ai_cost=$${(
      totalCostCents / 100
    ).toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
