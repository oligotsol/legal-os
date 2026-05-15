"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import {
  loadJurisdictionConfig,
  routeLead,
  UnsupportedJurisdictionError,
} from "@/lib/leads/jurisdiction-routing";

// ---------------------------------------------------------------------------
// CSV helpers — local so we don't pull in a csv-parse dep for the v1 scope.
// Handles quoted fields and escaped quotes ("").
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"' && cur === "") {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "full_name", "fullname", "full name", "contact", "contact name"],
  email: ["email", "email address", "e-mail", "e_mail"],
  phone: ["phone", "phone number", "mobile", "telephone", "cell"],
  state: ["state", "st"],
  city: ["city"],
  matter: ["matter", "matter_type", "matter type", "practice area", "area"],
  description: ["description", "notes", "summary", "comment", "details"],
};

function resolveHeaderIndex(headers: string[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[field];
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(headers[i].toLowerCase())) return i;
  }
  return -1;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8) return `+${digits}`;
  return null;
}

interface ImportRow {
  name: string;
  email: string | null;
  phone: string | null;
  state: string | null;
  city: string | null;
  matter: string | null;
  description: string | null;
}

/**
 * Get the current user's ID and firm ID. Throws if not authenticated or
 * user does not belong to a firm.
 */
async function getActorInfo(): Promise<{ userId: string; firmId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    throw new Error("User does not belong to a firm");
  }

  return { userId: user.id, firmId: membership.firm_id };
}

/**
 * Create a new lead from a manual entry (phone call, walk-in, referral).
 *
 * Creates lead + contact + conversation, fires classification event,
 * and returns IDs for navigation.
 */
export async function createLead(formData: FormData): Promise<{
  leadId: string;
  conversationId: string;
}> {
  const fullName = (formData.get("fullName") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const state = (formData.get("state") as string)?.trim() || null;
  const source = (formData.get("source") as string)?.trim() || "manual";
  const notes = (formData.get("notes") as string)?.trim() || null;

  if (!fullName) throw new Error("Name is required");
  if (!email && !phone) throw new Error("At least one of email or phone is required");

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  // Jurisdiction routing -- pull supported states + attorney map from
  // firm_config (no hardcoded list here). Reject manual creates whose state
  // is outside the supported set; allow leads with unknown state (they'll
  // backfill via the conversation flow).
  const jurisdictionConfig = await loadJurisdictionConfig(admin, firmId);
  const routing = routeLead(state, jurisdictionConfig);
  if (routing.decision === "unsupported") {
    throw new UnsupportedJurisdictionError(
      routing.normalizedState ?? state ?? "",
      jurisdictionConfig.supportedStates,
    );
  }

  // 1. Create contact
  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .insert({
      firm_id: firmId,
      full_name: fullName,
      email,
      phone,
      state: routing.normalizedState ?? state,
      source_lead_id: null,
      dnc: false,
    })
    .select("id")
    .single();

  if (contactErr || !contact) {
    throw new Error(`Failed to create contact: ${contactErr?.message}`);
  }

  // 2. Create lead
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .insert({
      firm_id: firmId,
      source: source as "manual" | "referral",
      status: "new",
      channel: "manual",
      full_name: fullName,
      email,
      phone,
      contact_id: contact.id,
      payload: notes ? { notes } : null,
      priority: 5,
      assigned_to: userId,
      state: routing.normalizedState,
      assigned_attorney_name: routing.assignedAttorneyName,
    })
    .select("id")
    .single();

  if (leadErr || !lead) {
    throw new Error(`Failed to create lead: ${leadErr?.message}`);
  }

  // Update contact's source_lead_id
  await admin
    .from("contacts")
    .update({ source_lead_id: lead.id })
    .eq("id", contact.id);

  // 3. Create conversation
  const { data: conversation, error: convoErr } = await admin
    .from("conversations")
    .insert({
      firm_id: firmId,
      lead_id: lead.id,
      contact_id: contact.id,
      status: "active",
      phase: "initial_contact",
      channel: "manual",
      message_count: 0,
    })
    .select("id")
    .single();

  if (convoErr || !conversation) {
    throw new Error(`Failed to create conversation: ${convoErr?.message}`);
  }

  // 4. Fire classification event
  try {
    await inngest.send({
      name: "lead.created",
      data: { leadId: lead.id, firmId },
    });
  } catch {
    // Non-fatal — classification will happen on next poll
    console.error("Failed to send lead.created event to Inngest");
  }

  // 5. Audit log
  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "lead.created_manually",
    p_entity_type: "lead",
    p_entity_id: lead.id,
    p_before: null,
    p_after: {
      full_name: fullName,
      email,
      phone,
      state,
      source,
      contact_id: contact.id,
      conversation_id: conversation.id,
    },
    p_metadata: { notes },
  });

  revalidatePath("/leads");
  revalidatePath("/conversations");
  revalidatePath("/dashboard");

  return { leadId: lead.id, conversationId: conversation.id };
}

/**
 * Bulk-import leads from a CSV text body.
 *
 * Required form fields:
 *   - csvText: raw CSV (header row + data rows)
 *   - listName: human-readable name for the list (stored on lead.payload.list_name)
 *
 * Each row creates a contact + a lead with `source='csv'`. Rows missing both
 * email and phone are skipped (we need at least one channel to act on them).
 * Duplicate detection by email/phone within the firm — existing contact
 * means we skip insertion of that row but still count it as "skipped".
 *
 * Returns counts and the first few error messages for surfacing in UI.
 */
export async function importLeadsCsv(formData: FormData): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  listName: string;
}> {
  const csvText = (formData.get("csvText") as string) ?? "";
  const listName = ((formData.get("listName") as string) ?? "").trim();

  if (!csvText.trim()) throw new Error("CSV is empty");
  if (!listName) throw new Error("List name is required");

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    name: resolveHeaderIndex(headers, "name"),
    email: resolveHeaderIndex(headers, "email"),
    phone: resolveHeaderIndex(headers, "phone"),
    state: resolveHeaderIndex(headers, "state"),
    city: resolveHeaderIndex(headers, "city"),
    matter: resolveHeaderIndex(headers, "matter"),
    description: resolveHeaderIndex(headers, "description"),
  };

  if (idx.email === -1 && idx.phone === -1) {
    throw new Error(
      "CSV must include at least an 'email' or 'phone' column — couldn't find either.",
    );
  }

  const rows: ImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: ImportRow = {
      name: idx.name >= 0 ? cells[idx.name] ?? "" : "",
      email:
        idx.email >= 0 && cells[idx.email] ? cells[idx.email].toLowerCase() : null,
      phone:
        idx.phone >= 0 && cells[idx.phone]
          ? normalizePhone(cells[idx.phone])
          : null,
      state: idx.state >= 0 && cells[idx.state] ? cells[idx.state] : null,
      city: idx.city >= 0 && cells[idx.city] ? cells[idx.city] : null,
      matter: idx.matter >= 0 && cells[idx.matter] ? cells[idx.matter] : null,
      description:
        idx.description >= 0 && cells[idx.description]
          ? cells[idx.description]
          : null,
    };
    if (!row.email && !row.phone) {
      errors.push(`Row ${i + 1}: missing email and phone — skipped.`);
      continue;
    }
    if (!row.name) {
      row.name = row.email ?? row.phone ?? `Lead ${i}`;
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("No valid rows after parsing — check CSV format.");
  }

  const { userId, firmId } = await getActorInfo();
  const admin = createAdminClient();

  // Load jurisdiction config once per import. Rows with state outside the
  // supported set are skipped with an error row; rows with no state are
  // imported unassigned (attorney backfills later).
  const jurisdictionConfig = await loadJurisdictionConfig(admin, firmId);

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const routing = routeLead(row.state, jurisdictionConfig);
    if (routing.decision === "unsupported") {
      skipped++;
      errors.push(
        `Row "${row.name}": state "${routing.normalizedState}" outside supported jurisdictions (${jurisdictionConfig.supportedStates.join(", ")}) — skipped.`,
      );
      continue;
    }

    // Dedup by email first, then phone, scoped to the firm.
    let existingContactId: string | null = null;
    if (row.email) {
      const { data } = await admin
        .from("contacts")
        .select("id")
        .eq("firm_id", firmId)
        .eq("email", row.email)
        .limit(1)
        .maybeSingle();
      if (data) existingContactId = data.id;
    }
    if (!existingContactId && row.phone) {
      const { data } = await admin
        .from("contacts")
        .select("id")
        .eq("firm_id", firmId)
        .eq("phone", row.phone)
        .limit(1)
        .maybeSingle();
      if (data) existingContactId = data.id;
    }

    if (existingContactId) {
      skipped++;
      continue;
    }

    // Create contact
    const { data: contact, error: contactErr } = await admin
      .from("contacts")
      .insert({
        firm_id: firmId,
        full_name: row.name,
        email: row.email,
        phone: row.phone,
        state: routing.normalizedState ?? row.state,
        dnc: false,
      })
      .select("id")
      .single();

    if (contactErr || !contact) {
      errors.push(`Contact insert failed for "${row.name}": ${contactErr?.message}`);
      continue;
    }

    // Create lead with source='csv' and list_name on payload
    const payload: Record<string, unknown> = {
      list_name: listName,
    };
    if (row.matter) payload.matter_type = row.matter;
    if (row.description) payload.client_description = row.description;
    if (row.city) payload.city = row.city;

    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .insert({
        firm_id: firmId,
        source: "csv",
        status: "new",
        channel: "manual",
        full_name: row.name,
        email: row.email,
        phone: row.phone,
        contact_id: contact.id,
        payload,
        priority: 5,
        assigned_to: userId,
        state: routing.normalizedState,
        assigned_attorney_name: routing.assignedAttorneyName,
      })
      .select("id")
      .single();

    if (leadErr || !lead) {
      errors.push(`Lead insert failed for "${row.name}": ${leadErr?.message}`);
      continue;
    }

    await admin
      .from("contacts")
      .update({ source_lead_id: lead.id })
      .eq("id", contact.id);

    imported++;
  }

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: userId,
    p_action: "leads.csv_import",
    p_entity_type: "lead",
    p_entity_id: null,
    p_before: null,
    p_after: { list_name: listName, imported, skipped, errors_count: errors.length },
    p_metadata: { row_count: rows.length },
  });

  revalidatePath("/leads");
  revalidatePath("/power-dialer");
  revalidatePath("/dashboard");

  return { imported, skipped, errors: errors.slice(0, 10), listName };
}
