import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized, shapeLead } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 20), 50);
  const status = sp.get("status");
  const source = sp.get("source");
  const listName = sp.get("list_name");

  const admin = createAdminClient();
  let q = admin
    .from("leads")
    .select(
      "id, full_name, source, status, channel, email, phone, payload, created_at, contacts:contact_id(full_name, email, phone, state, dnc)",
    )
    .eq("firm_id", a.firmId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  if (source) q = q.eq("source", source);
  if (listName) q = q.contains("payload", { list_name: listName });

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: (data ?? []).map(shapeLead) });
}
