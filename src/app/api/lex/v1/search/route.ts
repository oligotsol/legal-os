import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized, badRequest, shapeLead } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return badRequest("q must be at least 2 chars");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const ilike = `%${q.replace(/[%_]/g, "")}%`;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .select(
      "id, full_name, source, status, channel, email, phone, payload, created_at, contacts:contact_id(full_name, email, phone, state, dnc)",
    )
    .eq("firm_id", a.firmId)
    .is("deleted_at", null)
    .or(`full_name.ilike.${ilike},email.ilike.${ilike},phone.ilike.${ilike}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: (data ?? []).map(shapeLead) });
}
