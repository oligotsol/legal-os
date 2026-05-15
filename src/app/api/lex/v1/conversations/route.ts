import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 20), 50);
  const status = sp.get("status");

  const admin = createAdminClient();
  let q = admin
    .from("conversations")
    .select(
      "id, lead_id, channel, status, phase, last_message_at, contacts:contact_id(full_name)",
    )
    .eq("firm_id", a.firmId)
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}
