/**
 * Tests for engagement letter rendering.
 *
 * Fixture mirrors Garrison's PDF (LFL universal template) so the helpers'
 * output can be checked against PDF-derived expectations.
 */

import { describe, it, expect } from "vitest";
import {
  renderLetterHtml,
  renderLetterText,
  renderJurisdictionScheduleHtml,
  renderAttorneyBlocksHtml,
  renderPracticeAreaExpensesHtml,
  renderLetterheadHtml,
  escapeHtml,
  formatCurrency,
  type RenderLetterContext,
} from "@/lib/engagement/render-letter";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const GARRISON_BAR_CREDENTIALS = [
  { label: "Texas -- State Bar No.:", value: "24134411" },
  { label: "Iowa -- Commission ID:", value: "202799" },
  { label: "North Dakota -- Bar ID:", value: "10135" },
];

const BRIDGET_BAR_CREDENTIALS = [
  { label: "Pennsylvania -- Attorney ID No.:", value: "78828" },
  { label: "New Jersey -- Attorney ID No.:", value: "022801996" },
  { label: "USPTO -- Registration No.:", value: "47,333" },
];

function buildContext(
  overrides: Partial<RenderLetterContext> = {},
): RenderLetterContext {
  return {
    client_name: "Brian Clark",
    agreement_date: "May 12, 2026",
    jurisdiction: "PA",
    practice_area: "business_transactional",
    engagement_fee_amount: 3000,
    deposit_amount: 3000,
    services_description: "LLC Formation and Operating Agreement",
    firm_identity: {
      legal_name: "Legacy First Law, PLLC",
      address:
        "9110 N Loop 1604 W, Suite 104 PMB 1127, San Antonio, TX 78249-3397",
      phone: "(210) 939-6881",
      fax: "(855) 785-7597",
      email: "garrison@legacyfirstlaw.com",
      website: "legacyfirstlaw.com",
    },
    branding: {
      logo_url: null,
      primary_color: "#1a1a1a",
      secondary_color: "#888888",
      font_family: "Georgia, serif",
    },
    jurisdiction_schedule: {
      TX: {
        state_code: "TX",
        state_name: "Texas",
        attorney_of_record_name: 'William "Garrison" English, Esq.',
        governing_rules: "Texas Disciplinary Rules of Professional Conduct",
        confidentiality_rule: "TDRPC Rule 1.05",
        electronic_signatures: "Tex. Bus. & Com. Code 322.001-322.020",
        venue_county: "Bexar County, Texas",
        fee_dispute_program: "State Bar of Texas Fee Dispute Resolution Program",
        notary_statute: "Tex. Gov't Code Ann. 406.024",
      },
      IA: {
        state_code: "IA",
        state_name: "Iowa",
        attorney_of_record_name: 'William "Garrison" English, Esq.',
        governing_rules: "Iowa Rules of Professional Conduct",
        confidentiality_rule: "Iowa RPC Rule 32:1.6",
        electronic_signatures: "Iowa Code Ch. 554D",
        venue_county: "Polk County, Iowa",
        fee_dispute_program:
          "Iowa State Bar Association Fee Dispute Resolution Program",
        notary_statute: "Iowa Code Ch. 9B",
      },
      ND: {
        state_code: "ND",
        state_name: "North Dakota",
        attorney_of_record_name: 'William "Garrison" English, Esq.',
        governing_rules: "North Dakota Rules of Professional Conduct",
        confidentiality_rule: "ND RPC Rule 1.6",
        electronic_signatures: "N.D. Cent. Code Ch. 9-16",
        venue_county: "Burleigh County, North Dakota",
        fee_dispute_program:
          "State Bar Association of North Dakota Fee Arbitration Program",
        notary_statute: "N.D. Cent. Code Ch. 44-06.1",
      },
      PA: {
        state_code: "PA",
        state_name: "Pennsylvania",
        attorney_of_record_name: "Bridget Catherine Sciamanna, Esq.",
        governing_rules: "Pennsylvania Rules of Professional Conduct",
        confidentiality_rule: "Pa. RPC Rule 1.6",
        electronic_signatures: "73 Pa. Stat. 2260.101-2260.5101",
        venue_county: "Philadelphia County, Pennsylvania",
        fee_dispute_program:
          "Pennsylvania Bar Association Fee Dispute Resolution Program",
        notary_statute:
          "57 Pa.C.S. Ch. 3 (Revised Uniform Law on Notarial Acts)",
      },
      NJ: {
        state_code: "NJ",
        state_name: "New Jersey",
        attorney_of_record_name: "Bridget Catherine Sciamanna, Esq.",
        governing_rules: "New Jersey Rules of Professional Conduct",
        confidentiality_rule: "NJ RPC 1.6",
        electronic_signatures: "N.J. Stat. 12A:12-1 to 12A:12-26",
        venue_county: "Essex County, New Jersey",
        fee_dispute_program: "New Jersey Fee Arbitration Committee",
        notary_statute: "N.J.S.A. 52:7-10 et seq.",
      },
    },
    attorney_of_record_by_jurisdiction: {
      TX: {
        name: 'William "Garrison" English, Esq.',
        email: "garrison@legacyfirstlaw.com",
        bar_credentials: GARRISON_BAR_CREDENTIALS,
      },
      IA: {
        name: 'William "Garrison" English, Esq.',
        email: "garrison@legacyfirstlaw.com",
        bar_credentials: GARRISON_BAR_CREDENTIALS,
      },
      ND: {
        name: 'William "Garrison" English, Esq.',
        email: "garrison@legacyfirstlaw.com",
        bar_credentials: GARRISON_BAR_CREDENTIALS,
      },
      PA: {
        name: "Bridget Catherine Sciamanna, Esq.",
        email: "bridget@legacyfirstlaw.com",
        bar_credentials: BRIDGET_BAR_CREDENTIALS,
      },
      NJ: {
        name: "Bridget Catherine Sciamanna, Esq.",
        email: "bridget@legacyfirstlaw.com",
        bar_credentials: BRIDGET_BAR_CREDENTIALS,
      },
    },
    expenses_addendum_schedule: {
      fixed_service_fees: [
        {
          service: "eRecording -- Firm Service Fee",
          unit: "Per document",
          rate: "$10.00",
        },
        {
          service: "eFiling with State/Federal Agency",
          unit: "Per filing",
          rate: "$10.00",
        },
      ],
      notary_fees: [
        {
          service: "Acknowledgment or proof of deed/instrument",
          unit: "Per signature",
          rate: "Per statutory schedule",
        },
      ],
      by_practice_area: {
        estate_planning: {
          label: "5.1 Estate Planning",
          rows: [
            {
              service: "County Recording Fee -- Warranty Deed",
              unit: "Per deed",
              rate: "Actual -- varies by county",
            },
          ],
        },
        business_transactional: {
          label: "5.2 Business Transactional",
          rows: [
            {
              service: "Entity Formation Filing -- LLC",
              unit: "Per filing",
              rate: "Actual -- varies by state",
            },
          ],
        },
        ip: {
          label: "5.3 Intellectual Property (USPTO Fees)",
          rows: [
            {
              service: "Trademark Application",
              unit: "Per class",
              rate: "Per USPTO schedule",
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("formatCurrency", () => {
  it("formats whole dollars with two decimal places and grouping", () => {
    expect(formatCurrency(3000)).toBe("$3,000.00");
    expect(formatCurrency(1234567.5)).toBe("$1,234,567.50");
  });
});

// ---------------------------------------------------------------------------
// Scalar substitution
// ---------------------------------------------------------------------------

describe("renderLetterHtml — scalar substitution", () => {
  it("substitutes simple scalars", () => {
    const html = renderLetterHtml(`<p>Hello {client_name}</p>`, buildContext());
    expect(html).toBe(`<p>Hello Brian Clark</p>`);
  });

  it("escapes HTML in scalar values", () => {
    const html = renderLetterHtml(
      `<p>{client_name}</p>`,
      buildContext({ client_name: "<script>alert(1)</script>" }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("derives jurisdiction_name from jurisdiction_schedule[jurisdiction]", () => {
    const html = renderLetterHtml(
      `<p>JURISDICTION: {jurisdiction_name}</p>`,
      buildContext({ jurisdiction: "PA" }),
    );
    expect(html).toContain("JURISDICTION: Pennsylvania");
  });

  it("derives jurisdiction_name for each supported state", () => {
    const states: Array<[string, string]> = [
      ["TX", "Texas"],
      ["IA", "Iowa"],
      ["ND", "North Dakota"],
      ["PA", "Pennsylvania"],
      ["NJ", "New Jersey"],
    ];
    for (const [code, name] of states) {
      const html = renderLetterHtml(
        `<p>{jurisdiction_name}</p>`,
        buildContext({ jurisdiction: code }),
      );
      expect(html).toContain(name);
    }
  });

  it("formats engagement_fee_amount and deposit_amount as currency", () => {
    const html = renderLetterHtml(
      `<p>Fee: {engagement_fee_amount}, Deposit: {deposit_amount}</p>`,
      buildContext({ engagement_fee_amount: 3000, deposit_amount: 1500 }),
    );
    expect(html).toContain("Fee: $3,000.00");
    expect(html).toContain("Deposit: $1,500.00");
  });

  it("substitutes firm identity scalars", () => {
    const html = renderLetterHtml(
      `<p>{firm_legal_name} - {firm_phone} - {firm_website}</p>`,
      buildContext(),
    );
    expect(html).toContain("Legacy First Law, PLLC");
    expect(html).toContain("(210) 939-6881");
    expect(html).toContain("legacyfirstlaw.com");
  });

  it("leaves unknown placeholders unchanged", () => {
    const html = renderLetterHtml(
      `<p>{not_a_real_key}</p>`,
      buildContext(),
    );
    expect(html).toBe(`<p>{not_a_real_key}</p>`);
  });
});

// ---------------------------------------------------------------------------
// Exhibit A — full jurisdiction schedule
// ---------------------------------------------------------------------------

describe("renderJurisdictionScheduleHtml + {exhibit_a_html}", () => {
  it("renders all 5 jurisdictions regardless of selected jurisdiction", () => {
    const html = renderLetterHtml(
      `<div>{exhibit_a_html}</div>`,
      buildContext({ jurisdiction: "PA" }),
    );
    expect(html).toContain("TEXAS");
    expect(html).toContain("IOWA");
    expect(html).toContain("NORTH DAKOTA");
    expect(html).toContain("PENNSYLVANIA");
    expect(html).toContain("NEW JERSEY");
  });

  it("includes governing rules, venue county, and notary statute per state", () => {
    const html = renderLetterHtml(
      `<div>{exhibit_a_html}</div>`,
      buildContext(),
    );
    expect(html).toContain("Texas Disciplinary Rules of Professional Conduct");
    expect(html).toContain("Bexar County, Texas");
    expect(html).toContain("Iowa Code Ch. 9B");
    expect(html).toContain("Philadelphia County, Pennsylvania");
    expect(html).toContain("New Jersey Fee Arbitration Committee");
  });

  it("escapes ampersands in statute references", () => {
    const html = renderJurisdictionScheduleHtml(buildContext().jurisdiction_schedule);
    expect(html).toContain("Tex. Bus. &amp; Com. Code 322.001-322.020");
  });

  it("tags each state with a data-state attribute", () => {
    const html = renderJurisdictionScheduleHtml(buildContext().jurisdiction_schedule);
    for (const code of ["TX", "IA", "ND", "PA", "NJ"]) {
      expect(html).toContain(`data-state="${code}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Signature page — deduped attorney blocks
// ---------------------------------------------------------------------------

describe("renderAttorneyBlocksHtml + {attorney_blocks_html}", () => {
  it("dedupes attorneys by name and lists their jurisdictions", () => {
    const html = renderAttorneyBlocksHtml(
      buildContext().attorney_of_record_by_jurisdiction,
    );
    // Garrison block appears exactly once
    const garrisonMatches = html.match(/Garrison&quot; English/g) ?? [];
    expect(garrisonMatches.length).toBe(1);
    // Bridget block appears exactly once
    const bridgetMatches = html.match(/Bridget Catherine Sciamanna/g) ?? [];
    expect(bridgetMatches.length).toBe(1);
  });

  it("lists Garrison's jurisdictions in sorted order: IA, ND, TX", () => {
    const html = renderAttorneyBlocksHtml(
      buildContext().attorney_of_record_by_jurisdiction,
    );
    expect(html).toContain("Attorney of Record for IA, ND, TX");
  });

  it("lists Bridget's jurisdictions in sorted order: NJ, PA", () => {
    const html = renderAttorneyBlocksHtml(
      buildContext().attorney_of_record_by_jurisdiction,
    );
    expect(html).toContain("Attorney of Record for NJ, PA");
  });

  it("lists each attorney's bar credentials", () => {
    const html = renderAttorneyBlocksHtml(
      buildContext().attorney_of_record_by_jurisdiction,
    );
    expect(html).toContain("State Bar No.");
    expect(html).toContain("24134411");
    expect(html).toContain("Commission ID");
    expect(html).toContain("USPTO");
    expect(html).toContain("47,333");
  });

  it("renders within a full template via {attorney_blocks_html}", () => {
    const html = renderLetterHtml(
      `<section class="sig-page">{attorney_blocks_html}</section>`,
      buildContext(),
    );
    expect(html).toContain("Garrison");
    expect(html).toContain("Bridget");
  });
});

// ---------------------------------------------------------------------------
// Expenses addendum — per-practice-area + fixed tables
// ---------------------------------------------------------------------------

describe("renderPracticeAreaExpensesHtml + {practice_area_expenses_html}", () => {
  it("shows only the matter's practice area, not the others", () => {
    const html = renderLetterHtml(
      `<div>{practice_area_expenses_html}</div>`,
      buildContext({ practice_area: "business_transactional" }),
    );
    expect(html).toContain("Business Transactional");
    expect(html).toContain("Entity Formation Filing -- LLC");
    expect(html).not.toContain("Estate Planning");
    expect(html).not.toContain("Intellectual Property");
  });

  it("switches block when practice_area changes", () => {
    const ip = renderLetterHtml(
      `<div>{practice_area_expenses_html}</div>`,
      buildContext({ practice_area: "ip" }),
    );
    expect(ip).toContain("Intellectual Property");
    expect(ip).toContain("Trademark Application");
    expect(ip).not.toContain("Business Transactional");
    expect(ip).not.toContain("Estate Planning");

    const ep = renderLetterHtml(
      `<div>{practice_area_expenses_html}</div>`,
      buildContext({ practice_area: "estate_planning" }),
    );
    expect(ep).toContain("Estate Planning");
    expect(ep).toContain("County Recording Fee");
    expect(ep).not.toContain("Business Transactional");
    expect(ep).not.toContain("Intellectual Property");
  });

  it("returns empty string when practice_area is not in schedule", () => {
    const out = renderPracticeAreaExpensesHtml(
      buildContext().expenses_addendum_schedule,
      "nonexistent",
    );
    expect(out).toBe("");
  });
});

describe("{fixed_fees_rows_html} and {notary_fees_rows_html}", () => {
  it("renders fixed fee rows", () => {
    const html = renderLetterHtml(
      `<table>{fixed_fees_rows_html}</table>`,
      buildContext(),
    );
    expect(html).toContain("eRecording -- Firm Service Fee");
    expect(html).toContain("$10.00");
  });

  it("renders notary fee rows", () => {
    const html = renderLetterHtml(
      `<table>{notary_fees_rows_html}</table>`,
      buildContext(),
    );
    expect(html).toContain("Acknowledgment or proof of deed/instrument");
    expect(html).toContain("Per statutory schedule");
  });
});

// ---------------------------------------------------------------------------
// Letterhead
// ---------------------------------------------------------------------------

describe("renderLetterheadHtml + {letterhead_html}", () => {
  it("renders firm name, address, and contact info", () => {
    const html = renderLetterheadHtml(
      buildContext().firm_identity,
      buildContext().branding,
    );
    expect(html).toContain("LEGACY FIRST LAW");
    expect(html).toContain("9110 N Loop 1604 W");
    expect(html).toContain("(210) 939-6881");
    expect(html).toContain("(855) 785-7597");
    expect(html).toContain("legacyfirstlaw.com");
  });

  it("strips entity suffix from displayed firm name", () => {
    const html = renderLetterheadHtml(
      { ...buildContext().firm_identity, legal_name: "Legacy First Law, PLLC" },
      buildContext().branding,
    );
    expect(html).toContain("LEGACY FIRST LAW");
    expect(html).not.toContain("PLLC");
  });

  it("omits img tag when logo_url is null", () => {
    const html = renderLetterheadHtml(
      buildContext().firm_identity,
      { ...buildContext().branding, logo_url: null },
    );
    expect(html).not.toContain("<img");
  });

  it("includes img tag when logo_url is provided", () => {
    const html = renderLetterheadHtml(
      buildContext().firm_identity,
      {
        ...buildContext().branding,
        logo_url: "https://example.com/logo.png",
      },
    );
    expect(html).toContain('<img src="https://example.com/logo.png"');
  });

  it("threads branding into inline CSS custom properties", () => {
    const html = renderLetterheadHtml(
      buildContext().firm_identity,
      {
        logo_url: null,
        primary_color: "#abcdef",
        secondary_color: "#123456",
        font_family: "Georgia, serif",
      },
    );
    expect(html).toContain("--primary-color: #abcdef");
    expect(html).toContain("--secondary-color: #123456");
    expect(html).toContain("--font-family: Georgia, serif");
  });
});

// ---------------------------------------------------------------------------
// Golden — Section 1 prose with substitutions
// ---------------------------------------------------------------------------

describe("renderLetterHtml — golden Section 1", () => {
  it("renders Section 1 prose with scalar substitutions", () => {
    const template = `
<section id="parties-and-jurisdiction">
<h2>1. PARTIES AND JURISDICTION.</h2>
<p>This Attorney-Client Engagement Agreement (the "Agreement") is entered into on {agreement_date} (the "Agreement Date"), by and between {firm_legal_name} (the "Firm"), and {client_name} (the "Client"). The Firm and the Client are collectively referred to as the "Parties."</p>
<p>JURISDICTION: {jurisdiction_name}</p>
<p>The laws of the state identified above (the "Jurisdiction") govern this engagement.</p>
</section>
    `.trim();
    const html = renderLetterHtml(
      template,
      buildContext({
        client_name: "Brian Clark",
        agreement_date: "May 12, 2026",
        jurisdiction: "PA",
      }),
    );
    expect(html).toContain("entered into on May 12, 2026");
    expect(html).toContain("Legacy First Law, PLLC");
    expect(html).toContain("Brian Clark");
    expect(html).toContain("JURISDICTION: Pennsylvania");
  });
});

// ---------------------------------------------------------------------------
// Text fallback
// ---------------------------------------------------------------------------

describe("renderLetterText", () => {
  it("strips HTML tags from the output", () => {
    const text = renderLetterText(
      `<p>Hello <strong>{client_name}</strong>.</p>`,
      buildContext(),
    );
    expect(text).not.toContain("<");
    expect(text).toContain("Hello Brian Clark.");
  });

  it("decodes HTML entities introduced by escaping", () => {
    const text = renderLetterText(
      `<p>{client_name}</p>`,
      buildContext({ client_name: "M&M Co" }),
    );
    expect(text).toContain("M&M Co");
  });

  it("inserts line breaks at paragraph and heading boundaries", () => {
    const text = renderLetterText(
      `<h1>Hi</h1><p>One.</p><p>Two.</p>`,
      buildContext(),
    );
    expect(text).toMatch(/Hi\s+One\.\s+Two\./);
  });
});

// ---------------------------------------------------------------------------
// Em-dash hard rule
// ---------------------------------------------------------------------------

describe("no em dashes in renderer output", () => {
  it("does not emit em or en dashes anywhere in the rendered Exhibit A or signature page", () => {
    const html = renderLetterHtml(
      `<div>{exhibit_a_html}{attorney_blocks_html}{letterhead_html}{practice_area_expenses_html}</div>`,
      buildContext(),
    );
    expect(html).not.toMatch(/[–—]/); // en + em dashes
  });
});
