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
  const { id: queueItemId } = await params;

  let body: { comment?: string };
  try {
    body = (await req.json()) as { comment?: string };
  } catch {
    return badRequest("bad json");
  }
  const comment = body.comment?.trim();
  if (!comment) return badRequest("comment required");

  const admin = createAdminClient();
  const { data: item } = await admin
    .from("approval_queue")
    .select("id, metadata")
    .eq("id", queueItemId)
    .eq("firm_id", a.firmId)
    .maybeSingle();
  if (!item) return notFound("queue item not found");

  const md = (item.metadata ?? {}) as Record<string, unknown>;
  const prior = Array.isArray(md.lex_comments) ? md.lex_comments : [];
  const next = [...prior, { body: comment, at: new Date().toISOString() }];

  await admin
    .from("approval_queue")
    .update({ metadata: { ...md, lex_comments: next } })
    .eq("id", queueItemId);

  await audit(admin, a.firmId, "lex.comment_approval", "approval", queueItemId, {
    char_count: comment.length,
  });
  return NextResponse.json({ ok: true, queue_item_id: queueItemId });
}
