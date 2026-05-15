import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized, badRequest, notFound, audit } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();
  const { id: leadId } = await params;

  let body: { note?: string };
  try {
    body = (await req.json()) as { note?: string };
  } catch {
    return badRequest("bad json");
  }
  const note = body.note?.trim();
  if (!note) return badRequest("note required");

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, payload")
    .eq("id", leadId)
    .eq("firm_id", a.firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return notFound("lead not found");

  const payload = (lead.payload ?? {}) as Record<string, unknown>;
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const entry = { body: note, added_by: "lex_mcp", added_at: new Date().toISOString() };

  const { error } = await admin
    .from("leads")
    .update({ payload: { ...payload, notes: [...notes, entry] } })
    .eq("id", leadId)
    .eq("firm_id", a.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit(admin, a.firmId, "lex.add_note", "lead", leadId, {
    char_count: note.length,
  });
  return NextResponse.json({ ok: true, lead_id: leadId });
}
