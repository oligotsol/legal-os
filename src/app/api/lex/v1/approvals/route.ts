import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("approval_queue")
    .select("id, entity_type, action_type, priority, status, metadata, created_at")
    .eq("firm_id", a.firmId)
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approvals: data ?? [] });
}
