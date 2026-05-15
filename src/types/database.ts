/**
 * Manual database types matching the schema migrations.
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

// =============================================================================
// 00002_leads_and_intake types
// =============================================================================

export type MessageDirection = "inbound" | "outbound";

export type SenderType = "contact" | "ai" | "attorney" | "system";

export type LeadSource =
  | "legalmatch"
  | "nonstop"
  | "dialpad"
  | "manual"
  | "website"
  | "referral";

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "unqualified"
  | "converted"
  | "dead"
  | "dnc";

export type StageType =
  | "intake"
  | "qualification"
  | "negotiation"
  | "closing"
  | "post_close"
  | "terminal";

export type AiJobPurpose = "classify" | "converse" | "draft" | "judgment";

export type MatterStatus =
  | "active"
  | "on_hold"
  | "closed_won"
  | "closed_lost"
  | "dead";

export type ConversationStatus = "active" | "paused" | "closed" | "escalated";

export type ConversationPhase =
  | "initial_contact"
  | "qualification"
  | "scheduling"
  | "follow_up"
  | "negotiation"
  | "closing";

export type MessageStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "delivered"
  | "failed"
  | "rejected";

export type IntegrationProvider =
  | "dialpad"
  | "gmail"
  | "confido"
  | "dropbox_sign"
  | "postmark";

export type WebhookEventStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed";

export interface PipelineStage {
  id: string;
  firm_id: string;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  sla_hours: number | null;
  allowed_transitions: string[];
  is_terminal: boolean;
  stage_type: StageType;
  created_at: string;
  updated_at: string;
}

export interface AiJob {
  id: string;
  firm_id: string;
  model: string;
  purpose: AiJobPurpose;
  entity_type: string | null;
  entity_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cents: number | null;
  latency_ms: number | null;
  status: string;
  error: string | null;
  request_metadata: Record<string, unknown> | null;
  response_metadata: Record<string, unknown> | null;
  privileged: boolean;
  created_at: string;
}

export interface Contact {
  id: string;
  firm_id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  preferred_language: string | null;
  timezone: string | null;
  source_lead_id: string | null;
  dnc: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  firm_id: string;
  source: LeadSource;
  status: LeadStatus;
  channel: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  contact_id: string | null;
  payload: Record<string, unknown> | null;
  priority: number;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface Classification {
  id: string;
  firm_id: string;
  lead_id: string;
  matter_type: string;
  confidence: number;
  signals: Record<string, unknown> | null;
  model: string;
  ai_job_id: string | null;
  is_current: boolean;
  created_at: string;
}

export interface Matter {
  id: string;
  firm_id: string;
  contact_id: string;
  lead_id: string | null;
  matter_type: string | null;
  stage_id: string | null;
  status: MatterStatus;
  jurisdiction: string | null;
  assigned_to: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface MatterStageHistory {
  id: string;
  firm_id: string;
  matter_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  actor_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  firm_id: string;
  lead_id: string | null;
  contact_id: string | null;
  status: ConversationStatus;
  phase: ConversationPhase;
  context: Record<string, unknown> | null;
  channel: string | null;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  firm_id: string;
  conversation_id: string;
  direction: MessageDirection;
  channel: string | null;
  content: string | null;
  sender_type: SenderType;
  sender_id: string | null;
  status: MessageStatus;
  ai_generated: boolean;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationAccount {
  id: string;
  firm_id: string;
  provider: IntegrationProvider;
  credentials: Record<string, unknown>;
  status: string;
  last_sync_at: string | null;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  firm_id: string | null;
  provider: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: WebhookEventStatus;
  processed_at: string | null;
  error: string | null;
  idempotency_key: string | null;
  created_at: string;
}

// =============================================================================
// 00003_service_catalog types
// =============================================================================

export type ServiceCategory =
  | "estate_planning"
  | "business_transactional"
  | "trademark";

export type ServiceStatus = "active" | "archived" | "consultation_required";

export interface Service {
  id: string;
  firm_id: string;
  name: string;
  slug: string;
  category: ServiceCategory;
  description: string | null;
  standard_price: number;
  floor_price: number;
  filing_fee: number | null;
  status: ServiceStatus;
  created_at: string;
  updated_at: string;
}

export interface ServiceBundle {
  id: string;
  firm_id: string;
  name: string;
  slug: string;
  description: string | null;
  bundle_price: number;
  floor_price: number;
  service_ids: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscountTier {
  id: string;
  firm_id: string;
  engagement_threshold: number;
  discount_amount: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Quote calculation types (computed, not stored in DB)
// =============================================================================

export interface QuoteLineItem {
  service_id: string;
  service_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface QuoteCalculation {
  line_items: QuoteLineItem[];
  subtotal: number;
  bundle_discount: number;
  engagement_tier_discount: number;
  total_quoted_fee: number;
  floor_total: number;
  negotiation_headroom: number;
}

// =============================================================================
// 00004_approvals_fees_invoices types
// =============================================================================

export type ApprovalActionType =
  | "fee_quote"
  | "engagement_letter"
  | "invoice"
  | "message"
  | "other";

export type ApprovalQueueStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalDecision = "approved" | "rejected" | "edited_and_approved";

export type FeeQuoteStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "superseded";

export type EngagementLetterStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "viewed"
  | "signed"
  | "declined"
  | "expired";

export type InvoiceStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded";

export type IOLTAAccountType = "trust" | "operating";

export type EarningMethod = "milestone" | "earned_upon_receipt";

export type DripTriggerEvent =
  | "stage_entered"
  | "lead_created"
  | "quote_sent"
  | "engagement_sent"
  | "payment_received"
  | "manual";

export type DripChannel = "sms" | "email";

export type ScheduledActionStatus = "pending" | "sent" | "cancelled" | "failed";

export interface ApprovalQueueItem {
  id: string;
  firm_id: string;
  entity_type: string;
  entity_id: string;
  action_type: ApprovalActionType;
  priority: number;
  sla_deadline: string | null;
  status: ApprovalQueueStatus;
  assigned_to: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  firm_id: string;
  queue_item_id: string;
  decision: ApprovalDecision;
  decided_by: string;
  original_content: Record<string, unknown> | null;
  edited_content: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface Jurisdiction {
  id: string;
  firm_id: string;
  state_code: string;
  state_name: string;
  iolta_rule: string | null;
  iolta_account_type: IOLTAAccountType | null;
  earning_method: EarningMethod | null;
  milestone_split: number[] | null;
  requires_informed_consent: boolean;
  attorney_name: string | null;
  attorney_email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeeQuote {
  id: string;
  firm_id: string;
  matter_id: string;
  contact_id: string | null;
  line_items: Record<string, unknown>[];
  subtotal: number;
  bundle_discount: number;
  engagement_tier_discount: number;
  total_quoted_fee: number;
  floor_total: number;
  status: FeeQuoteStatus;
  negotiation_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface EngagementLetter {
  id: string;
  firm_id: string;
  matter_id: string;
  fee_quote_id: string | null;
  jurisdiction_id: string | null;
  template_key: string | null;
  variables: Record<string, unknown>;
  pdf_storage_path: string | null;
  e_sign_provider: string | null;
  e_sign_envelope_id: string | null;
  status: EngagementLetterStatus;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  firm_id: string;
  matter_id: string;
  fee_quote_id: string | null;
  engagement_letter_id: string | null;
  amount: number;
  payment_provider: string | null;
  payment_provider_id: string | null;
  payment_link: string | null;
  status: InvoiceStatus;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationSyncState {
  id: string;
  firm_id: string;
  integration_account_id: string;
  sync_type: string;
  cursor: string | null;
  last_polled_at: string | null;
  last_successful_at: string | null;
  error_count: number;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DripCampaign {
  id: string;
  firm_id: string;
  name: string;
  slug: string;
  description: string | null;
  trigger_stage_id: string | null;
  trigger_event: DripTriggerEvent;
  active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DripTemplate {
  id: string;
  firm_id: string;
  campaign_id: string;
  name: string;
  channel: DripChannel;
  subject: string | null;
  body_template: string;
  delay_hours: number;
  display_order: number;
  variant_label: string | null;
  active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Per-state payment language for template variable substitution (template 10) */
export interface PaymentLanguageConfig {
  [stateCode: string]: string;
}

export interface ScheduledAction {
  id: string;
  firm_id: string;
  campaign_id: string | null;
  template_id: string | null;
  matter_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  scheduled_for: string;
  status: ScheduledActionStatus;
  cancelled_reason: string | null;
  message_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
