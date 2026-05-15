import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized, notFound, shapeLead } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();
  const { id } = await params;

  const admin = createAdminClient();
  const [{ data: lead }, { data: convos }] = await Promise.all([
    admin
      .from("leads")
      .select(
        "id, full_name, source, status, channel, email, phone, payload, created_at, contacts:contact_id(full_name, email, phone, state, dnc)",
      )
      .eq("id", id)
      .eq("firm_id", a.firmId)
      .is("deleted_at", null)
      .maybeSingle(),
    admin
      .from("conversations")
      .select("id, channel, status, phase, last_message_at")
      .eq("firm_id", a.firmId)
      .eq("lead_id", id)
      .is("deleted_at", null),
  ]);

  if (!lead) return notFound("lead not found");

  const convIds = (convos ?? []).map((c) => c.id);
  const { data: messages } = convIds.length
    ? await admin
        .from("messages")
        .select(
          "id, conversation_id, direction, channel, content, sender_type, ai_generated, status, created_at",
        )
        .in("conversation_id", convIds)
        .order("created_at", { ascending: true })
        .limit(50)
    : { data: [] };

  return NextResponse.json({
    lead: shapeLead(lead),
    conversations: convos ?? [],
    messages: messages ?? [],
  });
}
