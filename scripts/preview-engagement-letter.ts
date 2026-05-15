/**
 * preview-engagement-letter.ts
 *
 * Renders the draft LFL universal engagement letter template against a fixture
 * context that mirrors Garrison's signed PDF (Brian Clark / PA / $3000 /
 * business_transactional) and writes the output to /tmp for visual review.
 *
 * Usage: npx tsx scripts/preview-engagement-letter.ts
 *
 * Disposable. Once #92 lands the template into firm_config and #86 wires the
 * generation entry point, this script's job is just iterating on the template
 * itself.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  renderLetterHtml,
  type RenderLetterContext,
} from "../src/lib/engagement/render-letter";

const TEMPLATE_PATH = resolve(__dirname, "lfl-engagement-letter-template.html");
const OUTPUT_PATH = "/tmp/lfl-engagement-letter-preview.html";

const PRINT_CSS = `
  :root {
    --primary-color: #1a1a1a;
    --secondary-color: #6b7280;
    --font-family: Georgia, "Times New Roman", serif;
    --letterhead-spacing: 0.4em;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--font-family);
    color: var(--primary-color);
    background: #f3f4f6;
    margin: 0;
    padding: 2rem;
    line-height: 1.55;
  }
  .doc {
    max-width: 8.5in;
    margin: 0 auto;
    background: white;
    padding: 0.75in 0.75in 1in;
    box-shadow: 0 4px 18px rgba(0,0,0,0.08);
  }
  .firm-letterhead {
    text-align: center;
    border-bottom: 1px solid var(--secondary-color);
    padding-bottom: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .firm-letterhead .firm-logo {
    max-height: 64px;
    margin-bottom: 0.5rem;
  }
  .firm-letterhead .firm-name {
    letter-spacing: var(--letterhead-spacing);
    margin: 0;
    font-size: 1.4rem;
  }
  .firm-letterhead .firm-address,
  .firm-letterhead .firm-contact {
    margin: 0.15rem 0;
    font-size: 0.85rem;
    color: var(--secondary-color);
  }
  .doc-title, .page-title {
    text-align: center;
    margin: 1.25rem 0 1.5rem;
    font-size: 1.15rem;
    letter-spacing: 0.05em;
  }
  .clause { margin-bottom: 1.25rem; }
  .clause h2 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
    text-transform: none;
  }
  .clause h3 {
    font-size: 0.95rem;
    margin: 0.75rem 0 0.35rem;
    font-style: italic;
  }
  .clause h4.block-heading {
    font-size: 0.9rem;
    margin: 0.75rem 0 0.35rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .clause p, .clause li { font-size: 0.92rem; }
  .jurisdiction-line { background: #fafafa; padding: 0.4rem 0.6rem; border-left: 3px solid var(--primary-color); }
  .services-description { font-weight: 600; padding-left: 1rem; border-left: 2px solid var(--secondary-color); }
  ol.alpha { list-style-type: lower-alpha; }
  ol.roman { list-style-type: lower-roman; }
  .next-page-notice { text-align: center; font-style: italic; color: var(--secondary-color); margin: 2rem 0; }
  .page-break { page-break-before: always; padding-top: 1.5rem; border-top: 1px dashed #d1d5db; margin-top: 2rem; }
  @media print {
    body { background: white; padding: 0; }
    .doc { box-shadow: none; padding: 0; }
    .page-break { border-top: none; }
  }
  .signature-page .signature-row { margin: 1.5rem 0; }
  .signature-page .signature-row h3 { font-size: 0.95rem; margin-bottom: 0.5rem; }
  .signature-page .signature-block { margin: 0.75rem 0 1.25rem; }
  .signature-page .sig-line { border-bottom: 1px solid var(--primary-color); height: 1.5rem; margin-bottom: 0.25rem; font-style: italic; }
  .signature-page .sig-meta { display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--secondary-color); }
  .signature-page .muted { color: var(--secondary-color); font-style: italic; }
  .attorney-block { margin: 1rem 0; padding: 0.75rem 1rem; background: #fafafa; border-left: 3px solid var(--secondary-color); }
  .attorney-block .attorney-name { font-weight: 600; margin: 0 0 0.25rem; }
  .attorney-block .attorney-jurisdictions { margin: 0 0 0.5rem; font-style: italic; color: var(--secondary-color); }
  .attorney-block .attorney-credentials { margin: 0; padding-left: 1.25rem; font-size: 0.85rem; }
  .exhibit-a-state { margin: 1rem 0; }
  .exhibit-a-state h3 { font-size: 1rem; letter-spacing: 0.05em; border-bottom: 1px solid var(--primary-color); padding-bottom: 0.25rem; }
  .exhibit-a-state dl { display: grid; grid-template-columns: 14rem 1fr; gap: 0.3rem 1rem; font-size: 0.85rem; }
  .exhibit-a-state dt { font-weight: 600; }
  .exhibit-a-state dd { margin: 0; }
  .expense-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; font-size: 0.85rem; }
  .expense-table th, .expense-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e5e7eb; text-align: left; }
  .expense-table th { background: #f9fafb; font-weight: 600; }
`;

// ---------------------------------------------------------------------------
// Fixture context (Brian Clark / PA / $3000 / business_transactional)
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

const fixture: RenderLetterContext = {
  client_name: "Brian Clark",
  agreement_date: "May 12, 2026",
  jurisdiction: "PA",
  practice_area: "business_transactional",
  engagement_fee_amount: 3000,
  deposit_amount: 3000,
  services_description: "2 LLC Formation and Operating Agreement",
  firm_identity: {
    legal_name: "Legacy First Law, PLLC",
    address: "9110 N Loop 1604 W, Suite 104 PMB 1127, San Antonio, TX 78249-3397",
    phone: "(210) 939-6881",
    fax: "(855) 785-7597",
    email: "garrison@legacyfirstlaw.com",
    website: "legacyfirstlaw.com",
  },
  branding: {
    logo_url: null,
    primary_color: "#1a1a1a",
    secondary_color: "#6b7280",
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
      fee_dispute_program: "Iowa State Bar Association Fee Dispute Resolution Program",
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
      fee_dispute_program: "State Bar Association of North Dakota Fee Arbitration Program",
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
      fee_dispute_program: "Pennsylvania Bar Association Fee Dispute Resolution Program",
      notary_statute: "57 Pa.C.S. Ch. 3 (Revised Uniform Law on Notarial Acts)",
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
    TX: { name: 'William "Garrison" English, Esq.', email: "garrison@legacyfirstlaw.com", bar_credentials: GARRISON_BAR_CREDENTIALS },
    IA: { name: 'William "Garrison" English, Esq.', email: "garrison@legacyfirstlaw.com", bar_credentials: GARRISON_BAR_CREDENTIALS },
    ND: { name: 'William "Garrison" English, Esq.', email: "garrison@legacyfirstlaw.com", bar_credentials: GARRISON_BAR_CREDENTIALS },
    PA: { name: "Bridget Catherine Sciamanna, Esq.", email: "bridget@legacyfirstlaw.com", bar_credentials: BRIDGET_BAR_CREDENTIALS },
    NJ: { name: "Bridget Catherine Sciamanna, Esq.", email: "bridget@legacyfirstlaw.com", bar_credentials: BRIDGET_BAR_CREDENTIALS },
  },
  expenses_addendum_schedule: {
    fixed_service_fees: [
      { service: "eRecording -- Firm Service Fee", unit: "Per document", rate: "$10.00" },
      { service: "eFiling with State/Federal Agency", unit: "Per filing", rate: "$10.00" },
      { service: "Certified Mail / FedEx / Courier", unit: "Per shipment", rate: "Actual cost" },
      { service: "Document Copying -- Paper", unit: "Per page", rate: "$0.25" },
      { service: "Document Copying -- Electronic", unit: "Per request", rate: "No charge" },
    ],
    notary_fees: [
      { service: "Acknowledgment or proof of deed/instrument", unit: "Per signature", rate: "Per statutory schedule" },
      { service: "Additional signature under same certificate", unit: "Per signature", rate: "Per statutory schedule" },
      { service: "Witness fee", unit: "Per witness", rate: "Per statutory schedule" },
      { service: "All other notarial acts", unit: "Per act", rate: "Per statutory schedule" },
    ],
    by_practice_area: {
      estate_planning: {
        label: "5.1 Estate Planning",
        rows: [
          { service: "County Recording Fee -- Warranty Deed", unit: "Per deed", rate: "Actual -- varies by county" },
          { service: "County Recording Fee -- TOD Deed", unit: "Per deed", rate: "Actual -- varies by county" },
          { service: "Secretary of State / State Agency Filing", unit: "Per filing", rate: "Actual -- varies by state" },
        ],
      },
      business_transactional: {
        label: "5.2 Business Transactional",
        rows: [
          { service: "Entity Formation Filing -- LLC", unit: "Per filing", rate: "Actual -- varies by state" },
          { service: "Entity Formation Filing -- Corporation", unit: "Per filing", rate: "Actual -- varies by state" },
          { service: "Registered Agent Service -- Annual", unit: "Per year", rate: "Actual -- varies by state" },
          { service: "Certificate of Good Standing", unit: "Per certificate", rate: "Actual -- varies by state" },
          { service: "Certified Copy of Formation Document", unit: "Per copy", rate: "Actual -- varies by state" },
        ],
      },
      ip: {
        label: "5.3 Intellectual Property (USPTO Fees)",
        rows: [
          { service: "Trademark Application", unit: "Per class", rate: "Per USPTO schedule" },
          { service: "Trademark Extension / Statement of Use", unit: "Per filing", rate: "Per USPTO schedule" },
          { service: "Trademark Section 8/15 Maintenance", unit: "Per filing", rate: "Per USPTO schedule" },
          { service: "Trademark Renewal (Section 9)", unit: "Per filing", rate: "Per USPTO schedule" },
          { service: "Patent -- Filing / Search / Exam Fees", unit: "Per application", rate: "Per USPTO schedule" },
          { service: "Patent -- Issue Fee", unit: "Per patent", rate: "Per USPTO schedule" },
          { service: "Patent -- Maintenance Fees", unit: "Per period", rate: "Per USPTO schedule" },
          { service: "Patent Drawing Preparation", unit: "Per sheet", rate: "Varies by illustrator" },
        ],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Render + write
// ---------------------------------------------------------------------------

const template = readFileSync(TEMPLATE_PATH, "utf8");
const body = renderLetterHtml(template, fixture);

const fullDoc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>LFL Engagement Letter Preview -- ${fixture.client_name} -- ${fixture.jurisdiction}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="doc">
${body}
</div>
</body>
</html>
`;

writeFileSync(OUTPUT_PATH, fullDoc);
console.log(`wrote ${OUTPUT_PATH}`);

if (process.argv.includes("--open")) {
  spawn("open", [OUTPUT_PATH], { stdio: "ignore", detached: true }).unref();
}
