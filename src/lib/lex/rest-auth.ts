/**
 * Shared bearer-token auth + response helpers for /api/lex/v1/* REST endpoints.
 *
 * Token lives in `integration_accounts` with provider='lex_mcp', status='active'.
 * Token value is in credentials.api_token. The same token the on-droplet stdio
 * MCP server uses to call these endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LexAuth {
  firmId: string;
}

export async function lexAuth(req: NextRequest): Promise<LexAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_accounts")
    .select("firm_id, credentials, status")
    .eq("provider", "lex_mcp")
    .eq("status", "active");
  for (const row of data ?? []) {
    const creds = row.credentials as { api_token?: string } | null;
    if (creds?.api_token && creds.api_token === token) {
      return { firmId: row.firm_id };
    }
  }
  return null;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export function notFound(msg = "not found"): NextResponse {
  return NextResponse.json({ error: msg }, { status: 404 });
}

export function shapeLead(l: {
  id: string;
  full_name: string | null;
  source: string;
  status: string;
  channel: string | null;
  email?: string | null;
  phone?: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  contacts?: unknown;
}) {
  const c = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as
    | { full_name?: string; email?: string; phone?: string; state?: string; dnc?: boolean }
    | null;
  const p = (l.payload ?? {}) as Record<string, unknown>;
  return {
    id: l.id,
    name: l.full_name ?? c?.full_name ?? null,
    email: l.email ?? c?.email ?? null,
    phone: l.phone ?? c?.phone ?? null,
    state: c?.state ?? null,
    source: l.source,
    status: l.status,
    channel: l.channel,
    dnc: c?.dnc ?? false,
    matter_type: (p.matter_type as string | undefined) ?? null,
    description: (p.description_summary as string | undefined) ?? null,
    description_full: (p.client_description as string | undefined) ?? null,
    list_name: (p.list_name as string | undefined) ?? null,
    original_source: (p.original_source as string | undefined) ?? null,
    created_at: l.created_at,
  };
}

export async function audit(
  admin: ReturnType<typeof createAdminClient>,
  firmId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.rpc("insert_audit_log", {
      p_firm_id: firmId,
      p_actor_id: null,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_before: null,
      p_after: meta,
      p_metadata: { source: "lex_mcp" },
    });
  } catch (err) {
    console.error("[lex/v1] audit_log insert failed:", err);
  }
}
