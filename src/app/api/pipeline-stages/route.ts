/**
 * Lightweight API route returning pipeline stages for the matter detail sheet.
 * Used by the TransitionButtons client component.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json([], { status: 401 });
  }

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id, name, slug, allowed_transitions")
    .order("display_order");

  return NextResponse.json(stages ?? []);
}
