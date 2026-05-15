/**
 * Render an engagement letter from a universal HTML template + a snapshotted
 * firm_config context. Pure function: no DB, no I/O.
 *
 * Substitution is scalar-only ({var}). Repeating sections (Exhibit A,
 * attorney blocks, expense tables, letterhead) are pre-rendered by helpers
 * in this file and injected via {*_html} placeholders. The template owns
 * all surrounding prose; helpers own data-driven structure.
 *
 * Note: do not introduce em dashes anywhere in template output. The source
 * PDF uses "--" (double hyphen) in place of em dashes; preserve that style.
 */

export type StateCode = string;
export type PracticeArea = string;

export interface FirmIdentity {
  legal_name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
}

export interface Branding {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  font_family: string;
}

export interface JurisdictionScheduleEntry {
  state_code: StateCode;
  state_name: string;
  attorney_of_record_name: string;
  governing_rules: string;
  confidentiality_rule: string;
  electronic_signatures: string;
  venue_county: string;
  fee_dispute_program: string;
  notary_statute: string;
}

export interface AttorneyBarCredential {
  label: string;
  value: string;
}

export interface AttorneyEntry {
  name: string;
  email?: string;
  bar_credentials: AttorneyBarCredential[];
}

export interface ExpenseRow {
  service: string;
  unit: string;
  rate: string;
}

export interface PracticeAreaExpenseSection {
  label: string;
  rows: ExpenseRow[];
}

export interface ExpensesAddendumSchedule {
  fixed_service_fees: ExpenseRow[];
  notary_fees: ExpenseRow[];
  by_practice_area: Record<PracticeArea, PracticeAreaExpenseSection>;
}

export interface RenderLetterContext {
  client_name: string;
  agreement_date: string;
  jurisdiction: StateCode;
  practice_area: PracticeArea;
  engagement_fee_amount: number;
  deposit_amount: number;
  services_description: string;

  firm_identity: FirmIdentity;
  branding: Branding;
  jurisdiction_schedule: Record<StateCode, JurisdictionScheduleEntry>;
  attorney_of_record_by_jurisdiction: Record<StateCode, AttorneyEntry>;
  expenses_addendum_schedule: ExpensesAddendumSchedule;
}

// ---------------------------------------------------------------------------
// Escape + format primitives
// ---------------------------------------------------------------------------

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

export function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Section helpers — data-driven HTML blocks
// ---------------------------------------------------------------------------

export function renderLetterheadHtml(
  firm: FirmIdentity,
  branding: Branding,
): string {
  const logo = branding.logo_url
    ? `<img src="${escapeHtml(branding.logo_url)}" alt="${escapeHtml(firm.legal_name)} logo" class="firm-logo" />`
    : "";
  const spacedName = escapeHtml(
    firm.legal_name.replace(/,?\s*(PLLC|LLC|PC|LLP|PA)$/i, "").toUpperCase(),
  );
  const styles = [
    `--primary-color: ${escapeHtml(branding.primary_color)}`,
    `--secondary-color: ${escapeHtml(branding.secondary_color)}`,
    `--font-family: ${escapeHtml(branding.font_family)}`,
  ].join("; ");
  return [
    `<header class="firm-letterhead" style="${styles}">`,
    logo,
    `<h1 class="firm-name">${spacedName}</h1>`,
    `<p class="firm-address">${escapeHtml(firm.address)}</p>`,
    `<p class="firm-contact">Phone: ${escapeHtml(firm.phone)} | Fax: ${escapeHtml(firm.fax)} | ${escapeHtml(firm.website)}</p>`,
    `</header>`,
  ].join("\n");
}

export function renderJurisdictionScheduleHtml(
  schedule: Record<StateCode, JurisdictionScheduleEntry>,
): string {
  const states = Object.keys(schedule).sort();
  return states
    .map((code) => {
      const j = schedule[code];
      return [
        `<section class="exhibit-a-state" data-state="${escapeHtml(code)}">`,
        `<h3>${escapeHtml(j.state_name.toUpperCase())}</h3>`,
        `<dl>`,
        `<dt>Attorney of Record</dt><dd>${escapeHtml(j.attorney_of_record_name)}</dd>`,
        `<dt>Governing Rules</dt><dd>${escapeHtml(j.governing_rules)}</dd>`,
        `<dt>Confidentiality Rule</dt><dd>${escapeHtml(j.confidentiality_rule)}</dd>`,
        `<dt>Electronic Signatures</dt><dd>${escapeHtml(j.electronic_signatures)}</dd>`,
        `<dt>Venue County</dt><dd>${escapeHtml(j.venue_county)}</dd>`,
        `<dt>Fee Dispute Program</dt><dd>${escapeHtml(j.fee_dispute_program)}</dd>`,
        `<dt>Notary Statute</dt><dd>${escapeHtml(j.notary_statute)}</dd>`,
        `</dl>`,
        `</section>`,
      ].join("\n");
    })
    .join("\n");
}

export function renderAttorneyBlocksHtml(
  attorneys_by_jurisdiction: Record<StateCode, AttorneyEntry>,
): string {
  // Dedupe by attorney name, collecting jurisdictions per attorney.
  // Iterate states in sorted order so output is deterministic.
  const byName = new Map<
    string,
    { attorney: AttorneyEntry; jurisdictions: StateCode[] }
  >();
  for (const code of Object.keys(attorneys_by_jurisdiction).sort()) {
    const a = attorneys_by_jurisdiction[code];
    const existing = byName.get(a.name);
    if (existing) {
      existing.jurisdictions.push(code);
    } else {
      byName.set(a.name, { attorney: a, jurisdictions: [code] });
    }
  }

  const blocks: string[] = [];
  for (const { attorney, jurisdictions } of byName.values()) {
    const credLines = attorney.bar_credentials
      .map(
        (c) =>
          `<li>${escapeHtml(c.label)} ${escapeHtml(c.value)}</li>`,
      )
      .join("\n");
    blocks.push(
      [
        `<div class="attorney-block">`,
        `<p class="attorney-name">${escapeHtml(attorney.name)}</p>`,
        `<p class="attorney-jurisdictions">Attorney of Record for ${escapeHtml(jurisdictions.join(", "))}</p>`,
        `<ul class="attorney-credentials">`,
        credLines,
        `</ul>`,
        `</div>`,
      ].join("\n"),
    );
  }
  return blocks.join("\n");
}

export function renderExpenseRowsHtml(rows: ExpenseRow[]): string {
  return rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.service)}</td><td>${escapeHtml(r.unit)}</td><td>${escapeHtml(r.rate)}</td></tr>`,
    )
    .join("\n");
}

export function renderPracticeAreaExpensesHtml(
  schedule: ExpensesAddendumSchedule,
  practice_area: PracticeArea,
): string {
  const section = schedule.by_practice_area[practice_area];
  if (!section) return "";
  return [
    `<section class="expenses-practice-area" data-practice-area="${escapeHtml(practice_area)}">`,
    `<h3>${escapeHtml(section.label)}</h3>`,
    `<table>`,
    `<thead><tr><th>Service / Expense</th><th>Unit</th><th>Rate</th></tr></thead>`,
    `<tbody>`,
    renderExpenseRowsHtml(section.rows),
    `</tbody>`,
    `</table>`,
    `</section>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Render map + substitution
// ---------------------------------------------------------------------------

interface RenderMapValue {
  value: string;
  raw: boolean;
}

function buildRenderMap(
  ctx: RenderLetterContext,
): Record<string, RenderMapValue> {
  const j = ctx.jurisdiction_schedule[ctx.jurisdiction];
  const jurisdictionName = j?.state_name ?? ctx.jurisdiction;

  return {
    // Letter scalars
    client_name: { value: ctx.client_name, raw: false },
    agreement_date: { value: ctx.agreement_date, raw: false },
    jurisdiction: { value: ctx.jurisdiction, raw: false },
    jurisdiction_name: { value: jurisdictionName, raw: false },
    practice_area: { value: ctx.practice_area, raw: false },
    engagement_fee_amount: {
      value: formatCurrency(ctx.engagement_fee_amount),
      raw: false,
    },
    deposit_amount: { value: formatCurrency(ctx.deposit_amount), raw: false },
    services_description: { value: ctx.services_description, raw: false },

    // Firm identity scalars
    firm_legal_name: { value: ctx.firm_identity.legal_name, raw: false },
    firm_address: { value: ctx.firm_identity.address, raw: false },
    firm_phone: { value: ctx.firm_identity.phone, raw: false },
    firm_fax: { value: ctx.firm_identity.fax, raw: false },
    firm_email: { value: ctx.firm_identity.email, raw: false },
    firm_website: { value: ctx.firm_identity.website, raw: false },

    // Pre-rendered HTML blocks
    letterhead_html: {
      value: renderLetterheadHtml(ctx.firm_identity, ctx.branding),
      raw: true,
    },
    exhibit_a_html: {
      value: renderJurisdictionScheduleHtml(ctx.jurisdiction_schedule),
      raw: true,
    },
    attorney_blocks_html: {
      value: renderAttorneyBlocksHtml(ctx.attorney_of_record_by_jurisdiction),
      raw: true,
    },
    fixed_fees_rows_html: {
      value: renderExpenseRowsHtml(ctx.expenses_addendum_schedule.fixed_service_fees),
      raw: true,
    },
    notary_fees_rows_html: {
      value: renderExpenseRowsHtml(ctx.expenses_addendum_schedule.notary_fees),
      raw: true,
    },
    practice_area_expenses_html: {
      value: renderPracticeAreaExpensesHtml(
        ctx.expenses_addendum_schedule,
        ctx.practice_area,
      ),
      raw: true,
    },
  };
}

function substitute(
  template: string,
  map: Record<string, RenderMapValue>,
): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (full, key: string) => {
    const entry = map[key];
    if (!entry) return full;
    return entry.raw ? entry.value : escapeHtml(entry.value);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderLetterHtml(
  template: string,
  ctx: RenderLetterContext,
): string {
  return substitute(template, buildRenderMap(ctx));
}

export function renderLetterText(
  template: string,
  ctx: RenderLetterContext,
): string {
  const html = renderLetterHtml(template, ctx);
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/dd>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
