/**
 * Bulk import a Lawcus leads-export CSV into Legal OS.
 *
 *   npx tsx scripts/import-lawcus-csv.ts <csv-path> [list-name] [firm-id]
 *
 * Defaults: list-name="Lawcus Export <YYYY-MM-DD>", firm-id=LFL.
 *
 * Each row → contact + lead with source='csv' so the existing leads CHECK
 * constraint is satisfied. `payload.list_name` carries the user-friendly
 * list name; `payload.original_source` carries Lawcus's source (e.g.
 * "Google Ads") so it can be filtered later.
 *
 * Dedupes by email/phone within the firm. Skips rows missing both. Runs
 * the description summarizer inline so each imported lead has a Lawcus-
 * style table description right away.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { createAdminClient } from "../src/lib/supabase/admin";
import { summarizeLeadDescription } from "../src/lib/ai/summarize-lead";
import { generateLeadDialerAssets } from "../src/lib/pipeline/generate-lead-dialer-assets";

const CSV_PATH = process.argv[2];
const LIST_NAME =
  process.argv[3] ??
  `Lawcus Export ${new Date().toISOString().slice(0, 10)}`;
const FIRM_ID = process.argv[4] ?? "00000000-0000-0000-0000-000000000001";

if (!CSV_PATH) {
  console.error("usage: npx tsx scripts/import-lawcus-csv.ts <csv-path> [list-name] [firm-id]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields + escaped quotes)
// ---------------------------------------------------------------------------

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
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"' && cur === "") {
      inQ = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
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
  // Lawcus format: "May 13, 2026 12:48:31"
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface Row {
  name: string;
  description: string | null;
  lastContacted: string | null;
  phone: string | null;
  source: string | null;
  createdAt: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Reading ${CSV_PATH}`);
  const raw = readFileSync(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    console.error("CSV needs at least a header + one row.");
    process.exit(1);
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const idx = {
    name: headers.indexOf("name"),
    description: headers.indexOf("description"),
    lastContacted: headers.indexOf("last contacted"),
    phone: headers.indexOf("lead phone"),
    source: headers.indexOf("lead source"),
    createdAt: headers.indexOf("lead created at"),
    email: headers.indexOf("lead email"),
  };

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    rows.push({
      name: idx.name >= 0 ? (cells[idx.name] ?? "").trim() : "",
      description:
        idx.description >= 0 && cells[idx.description]
          ? cells[idx.description].trim()
          : null,
      lastContacted:
        idx.lastContacted >= 0 ? parseDate(cells[idx.lastContacted] ?? "") : null,
      phone:
        idx.phone >= 0 && cells[idx.phone]
          ? normalizePhone(cells[idx.phone])
          : null,
      source: idx.source >= 0 && cells[idx.source] ? cells[idx.source].trim() : null,
      createdAt:
        idx.createdAt >= 0 ? parseDate(cells[idx.createdAt] ?? "") : null,
      email:
        idx.email >= 0 && cells[idx.email]
          ? cells[idx.email].trim().toLowerCase()
          : null,
    });
  }

  console.log(
    `Parsed ${rows.length} rows. list_name="${LIST_NAME}" firm=${FIRM_ID}`,
  );

  const admin = createAdminClient();
  let imported = 0;
  let skippedNoIdent = 0;
  let skippedDup = 0;
  let failed = 0;
  let totalCostCents = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.email && !r.phone) {
      skippedNoIdent++;
      continue;
    }

    // Dedupe.
    let existingContactId: string | null = null;
    if (r.email) {
      const { data } = await admin
        .from("contacts")
        .select("id")
        .eq("firm_id", FIRM_ID)
        .eq("email", r.email)
        .limit(1)
        .maybeSingle();
      if (data) existingContactId = data.id;
    }
    if (!existingContactId && r.phone) {
      const { data } = await admin
        .from("contacts")
        .select("id")
        .eq("firm_id", FIRM_ID)
        .eq("phone", r.phone)
        .limit(1)
        .maybeSingle();
      if (data) existingContactId = data.id;
    }
    if (existingContactId) {
      skippedDup++;
      continue;
    }

    const fullName = r.name || r.email || r.phone || `Lead ${i + 1}`;

    try {
      const { data: contact, error: contactErr } = await admin
        .from("contacts")
        .insert({
          firm_id: FIRM_ID,
          full_name: fullName,
          email: r.email,
          phone: r.phone,
          dnc: false,
        })
        .select("id")
        .single();
      if (contactErr || !contact) {
        failed++;
        console.error(`  row ${i}: contact insert failed:`, contactErr?.message);
        continue;
      }

      // Generate description summary inline (Lawcus-style services list).
      let descriptionSummary: string | null = null;
      try {
        const s = await summarizeLeadDescription({
          matterType: null,
          clientDescription: r.description,
          state: null,
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
            entity_id: null, // set after lead insert
            input_tokens: s.inputTokens,
            output_tokens: s.outputTokens,
            cost_cents: s.costCents,
            latency_ms: s.latencyMs,
            status: "completed",
            request_metadata: { source: "csv", list_name: LIST_NAME, backfill: true },
            privileged: false,
          });
        }
      } catch (e) {
        console.error(`  row ${i}: summarize failed:`, e instanceof Error ? e.message : e);
      }

      const payload: Record<string, unknown> = {
        list_name: LIST_NAME,
        original_source: r.source ?? null,
      };
      if (r.description) payload.client_description = r.description;
      if (descriptionSummary) payload.description_summary = descriptionSummary;

      const { data: lead, error: leadErr } = await admin
        .from("leads")
        .insert({
          firm_id: FIRM_ID,
          source: "csv",
          status: "new",
          channel: "manual",
          full_name: fullName,
          email: r.email,
          phone: r.phone,
          contact_id: contact.id,
          payload,
          priority: 5,
          created_at: r.createdAt ?? undefined,
        })
        .select("id")
        .single();
      if (leadErr || !lead) {
        failed++;
        console.error(`  row ${i}: lead insert failed:`, leadErr?.message);
        continue;
      }

      await admin
        .from("contacts")
        .update({ source_lead_id: lead.id })
        .eq("id", contact.id);

      // Generate the dialer call script + background brief inline so the
      // lead is dial-ready immediately, no separate backfill required.
      await generateLeadDialerAssets({
        admin,
        firmId: FIRM_ID,
        leadId: lead.id,
      });

      imported++;
      if (imported % 25 === 0) {
        console.log(`  ${imported} imported (${skippedDup} dup, ${skippedNoIdent} no-ident)`);
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
    `\nDone. imported=${imported} skipped_duplicate=${skippedDup} skipped_no_ident=${skippedNoIdent} failed=${failed} ai_cost=$${(
      totalCostCents / 100
    ).toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
