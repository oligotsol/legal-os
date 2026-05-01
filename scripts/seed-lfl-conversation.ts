/**
 * seed-lfl-conversation.ts — Seed LFL conversation engine data
 *
 * Seeds jurisdictions, drip campaigns, ~38 drip templates (19 templates
 * × SMS/email variants), and 7 firm_config keys for Legacy First Law.
 *
 * Usage:
 *   npx tsx scripts/seed-lfl-conversation.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent:
 *   - jurisdictions: upsert on (firm_id, state_code)
 *   - campaigns: upsert on (firm_id, slug)
 *   - firm_config: upsert on (firm_id, key)
 *   - templates: delete + re-insert (no unique constraint to upsert on)
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

// =============================================================================
// 1. Jurisdictions
// =============================================================================

interface JurisdictionDef {
  state_code: string;
  state_name: string;
  attorney_name: string;
  attorney_email: string;
  iolta_account_type: "trust" | "operating";
  earning_method: "milestone" | "earned_upon_receipt";
  milestone_split: number[] | null;
}

const JURISDICTIONS: JurisdictionDef[] = [
  {
    state_code: "TX",
    state_name: "Texas",
    attorney_name: "Garrison English",
    attorney_email: "garrison@legacyfirstlaw.com",
    iolta_account_type: "trust",
    earning_method: "milestone",
    milestone_split: [50, 50],
  },
  {
    state_code: "IA",
    state_name: "Iowa",
    attorney_name: "Garrison English",
    attorney_email: "garrison@legacyfirstlaw.com",
    iolta_account_type: "trust",
    earning_method: "milestone",
    milestone_split: [50, 50],
  },
  {
    state_code: "ND",
    state_name: "North Dakota",
    attorney_name: "Garrison English",
    attorney_email: "garrison@legacyfirstlaw.com",
    iolta_account_type: "trust",
    earning_method: "earned_upon_receipt",
    milestone_split: null,
  },
  {
    state_code: "PA",
    state_name: "Pennsylvania",
    attorney_name: "Bridget Sciamanna",
    attorney_email: "bridget@legacyfirstlaw.com",
    iolta_account_type: "trust",
    earning_method: "earned_upon_receipt",
    milestone_split: null,
  },
  {
    state_code: "NJ",
    state_name: "New Jersey",
    attorney_name: "Bridget Sciamanna",
    attorney_email: "bridget@legacyfirstlaw.com",
    iolta_account_type: "trust",
    earning_method: "earned_upon_receipt",
    milestone_split: null,
  },
];

// =============================================================================
// 2. Drip Campaigns
// =============================================================================

interface CampaignDef {
  name: string;
  slug: string;
  description: string;
  trigger_event: "lead_created" | "engagement_sent" | "payment_received" | "stage_entered" | "manual";
}

const CAMPAIGNS: CampaignDef[] = [
  {
    name: "Lead Stage",
    slug: "lead-stage",
    description: "Templates 1-6: Initial lead qualification and outreach",
    trigger_event: "lead_created",
  },
  {
    name: "Engagement Stage",
    slug: "engagement-stage",
    description: "Templates 7-9: Engagement letter flow",
    trigger_event: "engagement_sent",
  },
  {
    name: "Payment Stage",
    slug: "payment-stage",
    description: "Templates 10-12: Payment and invoice flow",
    trigger_event: "payment_received",
  },
  {
    name: "Post-Engagement",
    slug: "post-engagement",
    description: "Templates 13-15: Post-engagement onboarding",
    trigger_event: "stage_entered",
  },
  {
    name: "Follow-Up",
    slug: "follow-up",
    description: "Templates 16-18: Re-engagement and follow-up",
    trigger_event: "manual",
  },
  {
    name: "General",
    slug: "general",
    description: "Template 19: General communication",
    trigger_event: "manual",
  },
  {
    name: "Awaiting Reply (AI Drip)",
    slug: "awaiting-reply-ai",
    description: "AI-generated Day 2/5/7/10 follow-up messages for leads in awaiting_reply stage",
    trigger_event: "stage_entered",
  },
];

// =============================================================================
// 3. Drip Templates (19 templates × SMS/email variants)
// =============================================================================

interface TemplateDef {
  name: string;
  campaign_slug: string;
  channel: "sms" | "email";
  subject: string | null;
  body_template: string;
  delay_hours: number;
  display_order: number;
  variant_label: string | null;
}

const TEMPLATES: TemplateDef[] = [
  // -----------------------------------------------------------------------
  // LEAD STAGE (campaign: lead-stage) — Templates 1-6
  // -----------------------------------------------------------------------

  // Template 1: Initial outreach (SMS)
  {
    name: "T1: Initial Outreach (SMS)",
    campaign_slug: "lead-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, this is {{attorney_name}} with {{firm_name}}. I saw your inquiry and wanted to reach out personally. Do you have a few minutes to chat about your legal needs? — {{attorney_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: null,
  },
  // Template 1: Initial outreach (Email)
  {
    name: "T1: Initial Outreach (Email)",
    campaign_slug: "lead-stage",
    channel: "email",
    subject: "{{first_name}}, your inquiry with {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nThank you for reaching out to {{firm_name}}. I'm {{attorney_name}}, and I'd love to help you with your legal needs.\n\nI specialize in estate planning, business formation, and trademark protection — all at flat fees with no surprise invoices.\n\nWould you have a few minutes for a quick call? You can reach me directly or schedule a time here: {{scheduling_link}}\n\nLooking forward to connecting.\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: "email",
  },

  // Template 2: Follow-up if no response (SMS)
  {
    name: "T2: Follow-Up #1 (SMS)",
    campaign_slug: "lead-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, just following up on my earlier message. I'd love to help you get your legal matters taken care of. When works best for a quick call? — {{attorney_name}}",
    delay_hours: 24,
    display_order: 2,
    variant_label: null,
  },
  // Template 2: Follow-up (Email)
  {
    name: "T2: Follow-Up #1 (Email)",
    campaign_slug: "lead-stage",
    channel: "email",
    subject: "Following up — {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nI wanted to follow up on my previous message. I know life gets busy, but I don't want you to miss the opportunity to get your legal affairs in order.\n\nHere's what we can help with:\n- Estate planning (wills, trusts, powers of attorney)\n- Business formation and protection\n- Trademark registration and enforcement\n\nAll flat-fee, no hourly billing, and we typically deliver within 72 hours.\n\nSchedule a free consult: {{scheduling_link}}\n\n— {{attorney_name}}",
    delay_hours: 24,
    display_order: 2,
    variant_label: "email",
  },

  // Template 3: Scheduling prompt (SMS)
  {
    name: "T3: Schedule Consult (SMS)",
    campaign_slug: "lead-stage",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, I have some availability this week for a free consultation. Book a time that works: {{scheduling_link}} — {{attorney_name}}",
    delay_hours: 48,
    display_order: 3,
    variant_label: null,
  },
  // Template 3: Scheduling prompt (Email)
  {
    name: "T3: Schedule Consult (Email)",
    campaign_slug: "lead-stage",
    channel: "email",
    subject: "Free consultation — pick a time",
    body_template:
      "Hi {{first_name}},\n\nI have openings this week for a quick consultation. No cost, no obligation — just a chance to understand your situation and see if we can help.\n\nBook a time: {{scheduling_link}}\n\nMost of our clients get their estate planning or business docs done within 72 hours of our first call. Let's get started.\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 48,
    display_order: 3,
    variant_label: "email",
  },

  // Template 4: Value proposition (SMS)
  {
    name: "T4: Value Prop (SMS)",
    campaign_slug: "lead-stage",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, did you know most estate plans can be completed in 72 hours? Flat fees, no surprises. Let me show you how easy it is. — {{attorney_name}}",
    delay_hours: 96,
    display_order: 4,
    variant_label: null,
  },
  // Template 4: Value proposition (Email)
  {
    name: "T4: Value Prop (Email)",
    campaign_slug: "lead-stage",
    channel: "email",
    subject: "Why families choose {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nI wanted to share why families and business owners choose {{firm_name}}:\n\n1. Flat fees only — you'll know the total cost upfront\n2. 72-hour turnaround — most docs completed within 3 days\n3. 100% remote — sign everything digitally from home\n4. We work with you until it's perfect\n\nThe cost of waiting is real. Without proper planning, your family could face months in probate court and tens of thousands in unnecessary legal fees.\n\nLet's fix that: {{scheduling_link}}\n\n— {{attorney_name}}",
    delay_hours: 96,
    display_order: 4,
    variant_label: "email",
  },

  // Template 5: Urgency/consequence (SMS)
  {
    name: "T5: Urgency (SMS)",
    campaign_slug: "lead-stage",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, every day without a plan is another day your family is unprotected. I can help fix that this week. Want to chat? — {{attorney_name}}",
    delay_hours: 168,
    display_order: 5,
    variant_label: null,
  },

  // Template 6: Final lead-stage follow-up (SMS)
  {
    name: "T6: Final Follow-Up (SMS)",
    campaign_slug: "lead-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, this is my last follow-up. If you ever need help with estate planning or business docs, I'm here. Just reply to this message anytime. — {{attorney_name}}",
    delay_hours: 336,
    display_order: 6,
    variant_label: null,
  },

  // -----------------------------------------------------------------------
  // ENGAGEMENT STAGE (campaign: engagement-stage) — Templates 7-9
  // -----------------------------------------------------------------------

  // Template 7: Engagement letter sent notification (SMS)
  {
    name: "T7: Engagement Letter Sent (SMS)",
    campaign_slug: "engagement-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, I just sent your engagement letter to {{contact_name}} at {{attorney_email}}. Please review and sign at your earliest convenience. — {{attorney_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: null,
  },
  // Template 7: Engagement letter sent (Email)
  {
    name: "T7: Engagement Letter Sent (Email)",
    campaign_slug: "engagement-stage",
    channel: "email",
    subject: "Your engagement letter from {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nGreat news — your engagement letter is ready for review and signature.\n\nWhat this covers:\n- The scope of work we discussed\n- Our flat fee agreement\n- Timeline and deliverables\n\nPlease review it carefully and sign electronically. Once signed, we'll get started immediately.\n\nQuestions? Just reply to this email or call me directly.\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: "email",
  },

  // Template 8: Engagement letter reminder (SMS)
  {
    name: "T8: Engagement Reminder (SMS)",
    campaign_slug: "engagement-stage",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, just a reminder — your engagement letter is waiting for your signature. Once signed, we start immediately. — {{attorney_name}}",
    delay_hours: 48,
    display_order: 2,
    variant_label: null,
  },

  // Template 9: Final engagement reminder (SMS)
  {
    name: "T9: Final Engagement Reminder (SMS)",
    campaign_slug: "engagement-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, I want to make sure your engagement letter doesn't expire. Can you sign it today? Happy to answer any questions. — {{attorney_name}}",
    delay_hours: 120,
    display_order: 3,
    variant_label: null,
  },

  // -----------------------------------------------------------------------
  // PAYMENT STAGE (campaign: payment-stage) — Templates 10-12
  // -----------------------------------------------------------------------

  // Template 10: Invoice sent with IOLTA language (Email)
  {
    name: "T10: Invoice Sent (Email)",
    campaign_slug: "payment-stage",
    channel: "email",
    subject: "Invoice from {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nYour invoice is ready. Here are the details:\n\n{{payment_language}}\n\nPlease complete payment at your earliest convenience so we can begin work right away.\n\nIf you have questions about the invoice or payment options, just reply to this email.\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: null,
  },
  // Template 10: Invoice sent (SMS)
  {
    name: "T10: Invoice Sent (SMS)",
    campaign_slug: "payment-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, your invoice has been sent to your email. Once payment is received, we'll start work immediately. — {{attorney_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: "sms",
  },

  // Template 11: Payment reminder (SMS)
  {
    name: "T11: Payment Reminder (SMS)",
    campaign_slug: "payment-stage",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, friendly reminder that your invoice is still outstanding. We're ready to start as soon as payment is received. — {{attorney_name}}",
    delay_hours: 72,
    display_order: 2,
    variant_label: null,
  },

  // Template 12: Final payment reminder (SMS)
  {
    name: "T12: Final Payment Reminder (SMS)",
    campaign_slug: "payment-stage",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, just checking in on your invoice. Want to make sure we can get your matter moving. Need to discuss payment options? — {{attorney_name}}",
    delay_hours: 168,
    display_order: 3,
    variant_label: null,
  },

  // -----------------------------------------------------------------------
  // POST-ENGAGEMENT (campaign: post-engagement) — Templates 13-15
  // -----------------------------------------------------------------------

  // Template 13: Welcome / onboarding (Email)
  {
    name: "T13: Welcome (Email)",
    campaign_slug: "post-engagement",
    channel: "email",
    subject: "Welcome to {{firm_name}} — next steps",
    body_template:
      "Hi {{first_name}},\n\nWelcome to {{firm_name}}! We're excited to work with you.\n\nHere's what happens next:\n1. We'll review your information and begin drafting your documents\n2. You'll receive drafts for review within 72 hours\n3. We'll work with you on any revisions until everything is perfect\n4. Final documents will be sent for your signature\n\nIf you have any questions along the way, don't hesitate to reach out.\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: null,
  },
  // Template 13: Welcome (SMS)
  {
    name: "T13: Welcome (SMS)",
    campaign_slug: "post-engagement",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, welcome aboard! We've started on your matter. Expect drafts within 72 hours. Questions? Just text me. — {{attorney_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: "sms",
  },

  // Template 14: Status update (SMS)
  {
    name: "T14: Status Update (SMS)",
    campaign_slug: "post-engagement",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, just a quick update — your documents are in progress. We'll have drafts to you shortly. — {{attorney_name}}",
    delay_hours: 48,
    display_order: 2,
    variant_label: null,
  },

  // Template 15: Drafts ready notification (SMS)
  {
    name: "T15: Drafts Ready (SMS)",
    campaign_slug: "post-engagement",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, your document drafts are ready for review! Check your email for details. Let me know if you have any questions. — {{attorney_name}}",
    delay_hours: 72,
    display_order: 3,
    variant_label: null,
  },

  // -----------------------------------------------------------------------
  // FOLLOW-UP (campaign: follow-up) — Templates 16-18
  // -----------------------------------------------------------------------

  // Template 16: Re-engagement (SMS)
  {
    name: "T16: Re-Engagement (SMS)",
    campaign_slug: "follow-up",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, it's {{attorney_name}}. I wanted to check in — are you still interested in getting your legal matters handled? I'm here when you're ready. — {{attorney_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: null,
  },
  // Template 16: Re-engagement (Email)
  {
    name: "T16: Re-Engagement (Email)",
    campaign_slug: "follow-up",
    channel: "email",
    subject: "Checking in — {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nI hope you're doing well. I wanted to follow up on our previous conversation about your legal needs.\n\nIf your circumstances have changed or you have new questions, I'm happy to chat. Our flat-fee pricing and fast turnaround haven't changed.\n\nSchedule a call: {{scheduling_link}}\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: "email",
  },

  // Template 17: Second follow-up (SMS)
  {
    name: "T17: Follow-Up #2 (SMS)",
    campaign_slug: "follow-up",
    channel: "sms",
    subject: null,
    body_template:
      "{{first_name}}, just thinking about your situation. The sooner we get things in order, the better protected your family is. Want to schedule a quick call? — {{attorney_name}}",
    delay_hours: 168,
    display_order: 2,
    variant_label: null,
  },

  // Template 18: Final follow-up (SMS)
  {
    name: "T18: Final Follow-Up (SMS)",
    campaign_slug: "follow-up",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, I'll leave the ball in your court. Whenever you're ready to move forward, just text or call. No pressure. — {{attorney_name}}",
    delay_hours: 336,
    display_order: 3,
    variant_label: null,
  },

  // -----------------------------------------------------------------------
  // GENERAL (campaign: general) — Template 19
  // -----------------------------------------------------------------------

  // Template 19: General communication (Email)
  {
    name: "T19: General Communication (Email)",
    campaign_slug: "general",
    channel: "email",
    subject: "A message from {{firm_name}}",
    body_template:
      "Hi {{first_name}},\n\nThank you for your interest in {{firm_name}}. We're here to help with your legal needs — estate planning, business formation, trademarks, and more.\n\nFeel free to reach out anytime at {{attorney_email}} or schedule a consultation: {{scheduling_link}}\n\n— {{attorney_name}}\n{{firm_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: null,
  },
  // Template 19: General communication (SMS)
  {
    name: "T19: General Communication (SMS)",
    campaign_slug: "general",
    channel: "sms",
    subject: null,
    body_template:
      "Hi {{first_name}}, thanks for your interest in {{firm_name}}. I'm here to help — just reply or call anytime. — {{attorney_name}}",
    delay_hours: 0,
    display_order: 1,
    variant_label: "sms",
  },
];

// =============================================================================
// 4. Firm Config keys
// =============================================================================

const FIRM_CONFIG_ENTRIES: { key: string; value: Record<string, unknown> }[] = [
  {
    key: "classification_config",
    value: {
      model: "haiku",
      confidence_threshold: 0.7,
      matter_types: [
        "estate_planning",
        "business_transactional",
        "trademark",
      ],
    },
  },
  {
    key: "conversation_config",
    value: {
      model: "sonnet",
      max_tokens: 1024,
      temperature: 0.7,
      banned_phrases: [
        "Reach out", "Touching base", "Circling back",
        "At your earliest convenience", "We pride ourselves on",
        "It is well known that", "Here's what matters:",
        "procedural deadlines and notice requirements",
        "pressure point", "slam dunk", "textbook case",
        "clear cut", "open and shut", "will likely win",
        "solid case", "airtight claim",
      ],
      sms_char_limit: 300,
      casualness_level: 2,
      per_jurisdiction_sign_offs: {
        TX: { sms: "— Garrison", email: "— Garrison English\nLegacy First Law PLLC" },
        IA: { sms: "— Garrison", email: "— Garrison English\nLegacy First Law PLLC" },
        ND: { sms: "— Garrison", email: "— Garrison English\nLegacy First Law PLLC" },
        PA: { sms: "— Bridget", email: "— Bridget Sciamanna\nLegacy First Law PLLC" },
        NJ: { sms: "— Bridget", email: "— Bridget Sciamanna\nLegacy First Law PLLC" },
      },
      phone_number: "(210) 906-8835",
      firm_full_name: "Legacy First Law PLLC",
    },
  },
  {
    key: "qualification_config",
    value: {
      phases: [
        "initial_contact",
        "qualification",
        "scheduling",
        "follow_up",
      ],
      escalation_rules: {
        max_unanswered_messages: 3,
        escalation_delay_hours: 48,
        escalation_target: "attorney",
      },
    },
  },
  {
    key: "sms_config",
    value: {
      max_length: 300,
      sign_off: "— Garrison",
    },
  },
  {
    key: "email_config",
    value: {
      default_from: "hello@legacyfirstlaw.com",
      firm_name: "Legacy First Law PLLC",
      sign_off: "— Garrison English\nLegacy First Law PLLC",
    },
  },
  {
    key: "scheduling_config",
    value: {
      calendar_link: "https://calendar.app.google/fcsB6btsn9oJewjn7",
      available_hours: "Monday-Friday 9am-5pm CST",
    },
  },
  {
    key: "payment_language",
    value: {
      TX: "Funds will be deposited into our IOLTA trust account and held in trust until earned per our milestone-based fee agreement. 50% is earned upon execution of the engagement letter, and 50% upon delivery of final documents.",
      IA: "Funds will be deposited into our IOLTA trust account and held in trust until earned per our milestone-based fee agreement. 50% is earned upon execution of the engagement letter, and 50% upon delivery of final documents.",
      PA: "Per Pennsylvania Bar rules, fees are earned upon receipt. Your payment will be deposited into our operating account upon receipt.",
      NJ: "Per New Jersey Bar rules, fees are earned upon receipt. Your payment will be deposited into our operating account upon receipt.",
      ND: "Per North Dakota Bar rules, fees are earned upon receipt. Your payment will be deposited into our operating account upon receipt.",
    },
  },
  {
    key: "approval_mode",
    value: {
      // fee_quote, engagement_letter, invoice are ALWAYS always_review
      // (hard-coded gate in approval-mode.ts — config here is advisory only)
      fee_quote: "always_review",
      engagement_letter: "always_review",
      invoice: "always_review",
      // Messages default to always_review — set to "auto_approve" to skip attorney review
      message: "always_review",
      // Lead notifications default to always_review
      other: "always_review",
    },
  },
];

// =============================================================================
// Main
// =============================================================================

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Seeding LFL conversation engine data...\n");

  // ---------------------------------------------------------------
  // 1. Jurisdictions (upsert by firm_id + state_code)
  // ---------------------------------------------------------------
  const jurisdictionRows = JURISDICTIONS.map((j) => ({
    firm_id: LFL_FIRM_ID,
    state_code: j.state_code,
    state_name: j.state_name,
    attorney_name: j.attorney_name,
    attorney_email: j.attorney_email,
    iolta_account_type: j.iolta_account_type,
    earning_method: j.earning_method,
    milestone_split: j.milestone_split,
    requires_informed_consent: false,
    active: true,
  }));

  const { error: jurErr } = await supabase
    .from("jurisdictions")
    .upsert(jurisdictionRows, { onConflict: "firm_id,state_code" });

  if (jurErr) {
    console.error("Failed to seed jurisdictions:", jurErr.message);
    process.exit(1);
  }
  console.log(`1. Seeded ${JURISDICTIONS.length} jurisdictions`);

  // ---------------------------------------------------------------
  // 2. Drip campaigns (upsert by firm_id + slug)
  // ---------------------------------------------------------------
  const campaignRows = CAMPAIGNS.map((c) => ({
    firm_id: LFL_FIRM_ID,
    name: c.name,
    slug: c.slug,
    description: c.description,
    trigger_event: c.trigger_event,
    active: true,
  }));

  const { error: campErr } = await supabase
    .from("drip_campaigns")
    .upsert(campaignRows, { onConflict: "firm_id,slug" });

  if (campErr) {
    console.error("Failed to seed drip campaigns:", campErr.message);
    process.exit(1);
  }
  console.log(`2. Seeded ${CAMPAIGNS.length} drip campaigns`);

  // ---------------------------------------------------------------
  // 3. Resolve campaign IDs for template references
  // ---------------------------------------------------------------
  const { data: campRows, error: fetchCampErr } = await supabase
    .from("drip_campaigns")
    .select("id, slug")
    .eq("firm_id", LFL_FIRM_ID);

  if (fetchCampErr || !campRows) {
    console.error("Failed to fetch campaigns:", fetchCampErr?.message);
    process.exit(1);
  }

  const slugToId = new Map(campRows.map((r) => [r.slug, r.id]));

  // ---------------------------------------------------------------
  // 4. Drip templates (delete + re-insert — no unique constraint)
  // ---------------------------------------------------------------
  const { error: delErr } = await supabase
    .from("drip_templates")
    .delete()
    .eq("firm_id", LFL_FIRM_ID);

  if (delErr) {
    console.error("Failed to delete existing templates:", delErr.message);
    process.exit(1);
  }

  const templateRows = TEMPLATES.map((t) => {
    const campaignId = slugToId.get(t.campaign_slug);
    if (!campaignId) {
      console.warn(`  Warning: template "${t.name}" references unknown campaign: ${t.campaign_slug}`);
    }
    return {
      firm_id: LFL_FIRM_ID,
      campaign_id: campaignId,
      name: t.name,
      channel: t.channel,
      subject: t.subject,
      body_template: t.body_template,
      delay_hours: t.delay_hours,
      display_order: t.display_order,
      variant_label: t.variant_label,
      active: true,
    };
  });

  const { error: tplErr } = await supabase
    .from("drip_templates")
    .insert(templateRows);

  if (tplErr) {
    console.error("Failed to seed drip templates:", tplErr.message);
    process.exit(1);
  }
  console.log(`3. Seeded ${TEMPLATES.length} drip templates`);

  // ---------------------------------------------------------------
  // 5. Firm config (upsert by firm_id + key)
  // ---------------------------------------------------------------
  const configRows = FIRM_CONFIG_ENTRIES.map((c) => ({
    firm_id: LFL_FIRM_ID,
    key: c.key,
    value: c.value,
  }));

  const { error: cfgErr } = await supabase
    .from("firm_config")
    .upsert(configRows, { onConflict: "firm_id,key" });

  if (cfgErr) {
    console.error("Failed to seed firm_config:", cfgErr.message);
    process.exit(1);
  }
  console.log(`4. Seeded ${FIRM_CONFIG_ENTRIES.length} firm_config keys`);

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------
  console.log("\nConversation engine seed complete.");
  console.log(`  ${JURISDICTIONS.length} jurisdictions`);
  console.log(`  ${CAMPAIGNS.length} drip campaigns`);
  console.log(`  ${TEMPLATES.length} drip templates`);
  console.log(`  ${FIRM_CONFIG_ENTRIES.length} firm_config keys`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
