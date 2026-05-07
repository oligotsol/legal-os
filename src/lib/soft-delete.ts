/**
 * Soft-delete helpers for customer-data tables.
 *
 * Hard deletes are dangerous in legal context — even a stale lead row
 * may be discoverable. Use these helpers anywhere a user-initiated
 * "delete" runs. Reads must additionally filter `deleted_at IS NULL`
 * unless deliberately showing a "trash" / archive view.
 */

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Tables on which soft-delete is supported (mirrors the migration). */
export type SoftDeletableTable =
  | "leads"
  | "contacts"
  | "conversations"
  | "messages"
  | "matters";

/**
 * Mark a row as deleted by stamping `deleted_at = now()`. Scoped to
 * `firmId` so a request can never cross-firm-delete even if the id is
 * brute-forced.
 */
export async function softDelete(
  admin: AdminClient,
  table: SoftDeletableTable,
  id: string,
  firmId: string,
): Promise<void> {
  const { error } = await admin
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("firm_id", firmId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`softDelete(${table}, ${id}) failed: ${error.message}`);
  }
}

/**
 * Reverse a soft-delete. Useful for undo flows + admin tooling.
 */
export async function undelete(
  admin: AdminClient,
  table: SoftDeletableTable,
  id: string,
  firmId: string,
): Promise<void> {
  const { error } = await admin
    .from(table)
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("firm_id", firmId);
  if (error) {
    throw new Error(`undelete(${table}, ${id}) failed: ${error.message}`);
  }
}
