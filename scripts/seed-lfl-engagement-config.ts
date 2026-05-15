/**
 * seed-lfl-engagement-config.ts -- Seed LFL firm_config rows for the engagement
 * letter generator.
 *
 * Inserts the six firm_config keys read by src/lib/engagement/generate-letter.ts:
 *   - engagement_letter_template (HTML body from scripts/lfl-engagement-letter-template.html)
 *   - firm_identity
 *   - branding
 *   - jurisdiction_schedule (TX, IA, ND, PA, NJ from Garrison's PDF)
 *   - attorney_of_record_by_jurisdiction (Garrison TX/IA/ND, Bridget PA/NJ)
 *   - expenses_addendum_schedule (fixed fees + notary + 3 practice areas)
 *
 * Usage: npx tsx scripts/seed-lfl-engagement-config.ts
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Idempotent: upserts on (firm_id, key).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const GARRISON_CREDS = [
  { label: "Texas -- State Bar No.:", value: "24134411" },
  { label: "Iowa -- Commission ID:", value: "202799" },
  { label: "North Dakota -- Bar ID:", value: "10135" },
];

const BRIDGET_CREDS = [
  { label: "Pennsylvania -- Attorney ID No.:", value: "78828" },
  { label: "New Jersey -- Attorney ID No.:", value: "022801996" },
  { label: "USPTO -- Registration No.:", value: "47,333" },
];

const firmIdentity = {
  legal_name: "Legacy First Law, PLLC",
  address: "9110 N Loop 1604 W, Suite 104 PMB 1127, San Antonio, TX 78249-3397",
  phone: "(210) 939-6881",
  fax: "(855) 785-7597",
  email: "garrison@legacyfirstlaw.com",
  website: "legacyfirstlaw.com",
};

const branding = {
  // Replace with Supabase Storage URL once Oliver uploads the logo. Renderer
  // falls back to text-only letterhead when null.
  logo_url: null,
  primary_color: "#1a1a1a",
  secondary_color: "#6b7280",
  font_family: "Georgia, 'Times New Roman', serif",
};

const jurisdictionSchedule = {
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
};

const attorneyOfRecord = {
  TX: { name: 'William "Garrison" English, Esq.', email: "garrison@legacyfirstlaw.com", bar_credentials: GARRISON_CREDS },
  IA: { name: 'William "Garrison" English, Esq.', email: "garrison@legacyfirstlaw.com", bar_credentials: GARRISON_CREDS },
  ND: { name: 'William "Garrison" English, Esq.', email: "garrison@legacyfirstlaw.com", bar_credentials: GARRISON_CREDS },
  PA: { name: "Bridget Catherine Sciamanna, Esq.", email: "bridget@legacyfirstlaw.com", bar_credentials: BRIDGET_CREDS },
  NJ: { name: "Bridget Catherine Sciamanna, Esq.", email: "bridget@legacyfirstlaw.com", bar_credentials: BRIDGET_CREDS },
};

const expensesAddendum = {
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
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const templatePath = resolve(__dirname, "lfl-engagement-letter-template.html");
  const engagementLetterTemplate = readFileSync(templatePath, "utf8");

  const rows = [
    { key: "engagement_letter_template", value: engagementLetterTemplate },
    { key: "firm_identity", value: firmIdentity },
    { key: "branding", value: branding },
    { key: "jurisdiction_schedule", value: jurisdictionSchedule },
    { key: "attorney_of_record_by_jurisdiction", value: attorneyOfRecord },
    { key: "expenses_addendum_schedule", value: expensesAddendum },
  ];

  for (const row of rows) {
    const { error } = await admin
      .from("firm_config")
      .upsert(
        { firm_id: LFL_FIRM_ID, key: row.key, value: row.value },
        { onConflict: "firm_id,key" },
      );
    if (error) {
      console.error(`Failed to upsert ${row.key}: ${error.message}`);
      process.exit(1);
    }
    console.log(`upserted firm_config.${row.key}`);
  }

  console.log("\nLFL engagement letter config seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
