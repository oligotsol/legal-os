import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lexAuth, unauthorized, badRequest, notFound, audit } from "@/lib/lex/rest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  channel: "sms" | "email";
  content: string;
  subject?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await lexAuth(req);
  if (!a) return unauthorized();
  const { id: leadId } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("bad json");
  }
  if (body.channel !== "sms" && body.channel !== "email")
    return badRequest("channel must be sms or email");
  if (typeof body.content !== "string" || !body.content.trim())
    return badRequest("content required");

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("firm_id", a.firmId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead || !lead.contact_id) return notFound("lead not found");

  const { data: contact } = await admin
    .from("contacts")
    .select("full_name, email, phone")
    .eq("id", lead.contact_id)
    .maybeSingle();
  if (!contact) return notFound("contact not found");
  if (body.channel === "sms" && !contact.phone)
    return badRequest("contact has no phone");
  if (body.channel === "email" && !contact.email)
    return badRequest("contact has no email");

  // Resolve or create conversation
  const { data: existingConv } = await admin
    .from("conversations")
    .select("id")
    .eq("firm_id", a.firmId)
    .eq("lead_id", leadId)
    .eq("channel", body.channel)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let conversationId = existingConv?.id ?? null;
  if (!conversationId) {
    const { data: newConv } = await admin
      .from("conversations")
      .insert({
        firm_id: a.firmId,
        lead_id: leadId,
        contact_id: lead.contact_id,
        status: "active",
        phase: "initial_contact",
        channel: body.channel,
        message_count: 0,
      })
      .select("id")
      .single();
    conversationId = newConv?.id ?? null;
  }
  if (!conversationId)
    return NextResponse.json({ error: "could not create conversation" }, { status: 500 });

  const metadata: Record<string, unknown> = { source: "lex_mcp" };
  if (body.subject) metadata.subject = body.subject;

  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      firm_id: a.firmId,
      conversation_id: conversationId,
      direction: "outbound",
      channel: body.channel,
      content: body.content,
      sender_type: "ai",
      ai_generated: true,
      status: "pending_approval",
      metadata,
    })
    .select("id")
    .single();
  if (msgErr || !msg)
    return NextResponse.json({ error: msgErr?.message ?? "insert failed" }, { status: 500 });

  const { data: queueItem, error: qErr } = await admin
    .from("approval_queue")
    .insert({
      firm_id: a.firmId,
      entity_type: "message",
      entity_id: msg.id,
      action_type: "message",
      priority: 5,
      status: "pending",
      metadata: {
        contact_name: contact.full_name,
        channel: body.channel,
        lead_id: leadId,
        source: "lex_mcp",
        summary:
          body.content.length > 120 ? body.content.slice(0, 120) + "…" : body.content,
      },
    })
    .select("id")
    .single();
  if (qErr || !queueItem)
    return NextResponse.json({ error: qErr?.message ?? "queue insert failed" }, { status: 500 });

  await audit(admin, a.firmId, "lex.draft_message", "message", msg.id, {
    lead_id: leadId,
    channel: body.channel,
    char_count: body.content.length,
  });

  return NextResponse.json({
    message_id: msg.id,
    queue_item_id: queueItem.id,
    conversation_id: conversationId,
    status: "pending_approval",
    note: "Drafted. Garrison must approve in the CRM before it dispatches.",
  });
}
