/**
 * Manual database types matching the foundation schema (00001_foundation.sql).
 * Replace with auto-generated types from `supabase gen types typescript` once
 * the project is connected to a live Supabase instance.
 */

export type UserRole = "owner" | "attorney" | "paralegal" | "assistant" | "viewer";

export type FirmStatus = "active" | "suspended" | "churned";

export interface Firm {
  id: string;
  name: string;
  slug: string;
  status: FirmStatus;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface FirmUser {
  id: string;
  firm_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface FirmConfig {
  id: string;
  firm_id: string;
  key: string;
  value: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  firm_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  hash: string;
  prev_hash: string;
  created_at: string;
}
