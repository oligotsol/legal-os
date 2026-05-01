import { describe, it, expect } from "vitest";
import { selectTemplate, buildQualifyMessage } from "@/lib/ai/conversation/qualify";
import type {
  Lead,
  Contact,
  Conversation,
  Jurisdiction,
  DripTemplate,
  ConversationPhase,
  ConversationStatus,
} from "@/types/database";

// --- Test fixtures ---

const makeLead = (overrides?: Partial<Lead>): Lead => ({
  id: "lead-1",
  firm_id: "firm-1",
  source: "website",
  status: "new",
  channel: "web",
  full_name: "John Doe",
  email: "john@example.com",
  phone: "555-123-4567",
  contact_id: "contact-1",
  payload: { matter_type: "estate_planning" },
  priority: 0,
  assigned_to: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeContact = (overrides?: Partial<Contact>): Contact => ({
  id: "contact-1",
  firm_id: "firm-1",
  email: "john@example.com",
  phone: "555-123-4567",
  full_name: "John Doe",
  address_line1: null,
  address_line2: null,
  city: null,
  state: "TX",
  zip: null,
  country: null,
  preferred_language: null,
  timezone: null,
  source_lead_id: "lead-1",
  dnc: false,
  metadata: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeConversation = (overrides?: Partial<Conversation>): Conversation => ({
  id: "conv-1",
  firm_id: "firm-1",
  lead_id: "lead-1",
  contact_id: "contact-1",
  status: "active",
  phase: "initial_contact",
  context: null,
  channel: "sms",
  last_message_at: null,
  message_count: 0,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const txJurisdiction: Jurisdiction = {
  id: "jur-tx",
  firm_id: "firm-1",
  state_code: "TX",
  state_name: "Texas",
  iolta_rule: null,
  iolta_account_type: "trust",
  earning_method: "milestone",
  milestone_split: [50, 50],
  requires_informed_consent: false,
  attorney_name: "Garrison English",
  attorney_email: "garrison@legacyfirstlaw.com",
  notes: null,
  active: true,
  created_at: "",
  updated_at: "",
};

const paJurisdiction: Jurisdiction = {
  ...txJurisdiction,
  id: "jur-pa",
  state_code: "PA",
  state_name: "Pennsylvania",
  earning_method: "earned_upon_receipt",
  milestone_split: null,
  attorney_name: "Bridget Sciamanna",
  attorney_email: "bridget@legacyfirstlaw.com",
};

const makeTemplate = (
  overrides: Partial<DripTemplate> & Pick<DripTemplate, "id" | "display_order">,
): DripTemplate => ({
  firm_id: "firm-1",
  campaign_id: "camp-1",
  name: `Template ${overrides.display_order}`,
  channel: "sms",
  subject: null,
  body_template: "Hi {{first_name}}, this is {{attorney_name}}.",
  delay_hours: 0,
  variant_label: null,
  active: true,
  metadata: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const templates: DripTemplate[] = [
  makeTemplate({ id: "tpl-1", display_order: 1 }),
  makeTemplate({ id: "tpl-2", display_order: 2 }),
  makeTemplate({ id: "tpl-3", display_order: 3 }),
  makeTemplate({
    id: "tpl-4",
    display_order: 4,
    channel: "email",
    subject: "{{firm_name}} — Next Steps",
    body_template:
      "Dear {{contact_name}},\n\nThank you for reaching out to {{firm_name}}.\n\n— {{attorney_name}}",
  }),
];

const firmConfig: Record<string, Record<string, unknown>> = {
  scheduling_config: { calendar_link: "https://cal.com/lfl/consult", available_hours: "9-5 CST" },
  email_config: { firm_name: "Legacy First Law PLLC", default_from: "hello@legacyfirstlaw.com" },
  sms_config: { max_length: 300, sign_off: "— Garrison" },
  payment_language: {
    TX: "Funds will be deposited into our IOLTA trust account and held until earned per milestone.",
    PA: "Funds are earned upon receipt per PA Bar rules.",
  },
};

// --- Tests ---

describe("selectTemplate", () => {
  it("selects first template for new conversation (message_count=0)", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ message_count: 0 }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    const result = selectTemplate(input);
    expect(result?.id).toBe("tpl-1");
  });

  it("selects second template after first message sent", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ message_count: 1 }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    const result = selectTemplate(input);
    expect(result?.id).toBe("tpl-2");
  });

  it("returns null when all templates exhausted", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ message_count: 4 }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(selectTemplate(input)).toBeNull();
  });

  it("returns null for closed conversation", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ status: "closed" as ConversationStatus }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(selectTemplate(input)).toBeNull();
  });

  it("returns null for escalated conversation", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ status: "escalated" as ConversationStatus }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(selectTemplate(input)).toBeNull();
  });

  it("returns null for negotiation phase (not a qualify phase)", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ phase: "negotiation" as ConversationPhase }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(selectTemplate(input)).toBeNull();
  });

  it("skips inactive templates", () => {
    const mixedTemplates = [
      makeTemplate({ id: "tpl-inactive", display_order: 1, active: false }),
      makeTemplate({ id: "tpl-active", display_order: 2 }),
    ];

    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ message_count: 0 }),
      jurisdiction: txJurisdiction,
      templates: mixedTemplates,
      firmConfig,
    };

    expect(selectTemplate(input)?.id).toBe("tpl-active");
  });

  it("works with qualification phase", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ phase: "qualification" }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(selectTemplate(input)?.id).toBe("tpl-1");
  });
});

describe("buildQualifyMessage", () => {
  it("routes TX lead to Garrison", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation(),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    const result = buildQualifyMessage(input);
    expect(result).not.toBeNull();
    expect(result!.context.attorney_name).toBe("Garrison English");
    expect(result!.context.attorney_email).toBe("garrison@legacyfirstlaw.com");
  });

  it("routes PA lead to Bridget", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact({ state: "PA" }),
      conversation: makeConversation(),
      jurisdiction: paJurisdiction,
      templates,
      firmConfig,
    };

    const result = buildQualifyMessage(input);
    expect(result).not.toBeNull();
    expect(result!.context.attorney_name).toBe("Bridget Sciamanna");
    expect(result!.context.attorney_email).toBe("bridget@legacyfirstlaw.com");
  });

  it("builds complete TemplateContext", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation(),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    const result = buildQualifyMessage(input);
    expect(result).not.toBeNull();

    const ctx = result!.context;
    expect(ctx.contact_name).toBe("John Doe");
    expect(ctx.first_name).toBe("John");
    expect(ctx.attorney_name).toBe("Garrison English");
    expect(ctx.firm_name).toBe("Legacy First Law PLLC");
    expect(ctx.phone_number).toBe("555-123-4567");
    expect(ctx.scheduling_link).toBe("https://cal.com/lfl/consult");
    expect(ctx.state).toBe("TX");
    expect(ctx.payment_language).toContain("IOLTA trust account");
  });

  it("renders SMS template for SMS channel", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation(),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    const result = buildQualifyMessage(input);
    expect(result).not.toBeNull();
    expect(result!.channel).toBe("sms");
    expect(result!.renderedContent).toBe("Hi John, this is Garrison English.");
    expect(result!.suggestedSubject).toBeUndefined();
  });

  it("renders email template with subject", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ message_count: 3 }), // 4th template is email
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    const result = buildQualifyMessage(input);
    expect(result).not.toBeNull();
    expect(result!.channel).toBe("email");
    expect(result!.suggestedSubject).toBe("Legacy First Law PLLC — Next Steps");
    expect(result!.renderedContent).toContain("Dear John Doe");
    expect(result!.renderedContent).toContain("— Garrison English");
  });

  it("returns null when conversation is closed", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ status: "closed" }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(buildQualifyMessage(input)).toBeNull();
  });

  it("returns null when no templates remain", () => {
    const input = {
      lead: makeLead(),
      contact: makeContact(),
      conversation: makeConversation({ message_count: 10 }),
      jurisdiction: txJurisdiction,
      templates,
      firmConfig,
    };

    expect(buildQualifyMessage(input)).toBeNull();
  });
});
