# Legal OS — Architecture (v1)

**Prepared:** April 22, 2026
**For:** LFL v1 build, ~8-week target
**Status:** Working document

---

## 1. What We're Building

A vertical AI intake and sales platform for law firms. v1 scope: **lead arrives → AI qualifies and converses → attorney makes the call → fee is quoted and agreed → engagement letter signed → invoice paid → matter marked ready for production.**

Out of scope for v1: document generation, triple-verify, attorney document review, delivery automation, patent practice, post-delivery workflows. These are v2+.

Built multi-tenant from day one. Ships with one live tenant (Legacy First Law). White-label comes in v3.

**No migration.** Garrison provides vision and domain expertise; we build clean. His prior design documents inform the product spec, not the implementation.

---

## 2. Core Design Principles

1. **Platform is source of truth.** All data lives in our Postgres. Lawcus and any future CRMs are integrations — we sync with them, but our database is authoritative.

2. **Hybrid multi-tenancy from day one.** Shared application layer, tenant-scoped data, row-level security at the database. Every non-global row has `firm_id`. v1 has one firm; adding more requires no rewrites.

3. **Configuration in the database, not code.** Fee schedules, pipeline stages, drip templates, competitor rebuttals, call scripts, state rules — all tenant-scoped rows. v1 seeds LFL's config. v3 adds a UI for editing.

4. **Attorney approval is a first-class concept.** Outbound artifacts can be gated behind an approval queue. Each action type has a mode: `always_approve | auto_send_with_audit | auto_send`. Defaults to `always_approve` — autonomy is earned.

5. **Tamper-evident audit log from day one.** Append-only, hash-chained. This is the malpractice defense and the foundation of "attorney is liable." Non-negotiable.

6. **AI is an abstraction.** Thin internal layer (`ai.classify()`, `ai.converse()`, `ai.draft()`) routes tasks to models. Defaults: Haiku 4.5 classify, Sonnet 4.6 converse, Opus 4.7 judgment. Model choice is a config value per tenant.

7. **Every integration is an adapter.** Dialpad, Gmail, Confido, Dropbox Sign, Anthropic — each behind a standard interface. Swappable per tenant.

---

## 3. System Architecture

```
INGESTION: LegalMatch poller │ NonStop webhook │ Dialpad webhook │ Manual entry
                                     │
                        ┌────────────▼────────────┐
                        │  LEAD INTAKE SERVICE     │
                        │  Normalize, dedupe, DNC  │
                        └────────────┬────────────┘
                                     │
CORE PLATFORM (Next.js / Railway)
  Classifier (Haiku) → Conversation Engine (Sonnet) → Pipeline Manager
  → Approval Queue → Drip Engine → Fee Builder → Engagement Letter
  → Invoice + Payment → Command Center (attorney UI)
                                     │
WORKERS (Railway): Drip scheduler │ AI runner │ Webhook processor │ Crons
                                     │
DATA (Supabase): Postgres RLS │ Auth │ Storage │ Realtime │ Audit log
                                     │
ADAPTERS: Dialpad │ Gmail │ Confido │ Dropbox Sign │ Anthropic │ Lawcus (opt)
```

---

## 4. Technology Stack

| Layer | Choice |
|---|---|
| Web framework | Next.js 15 (App Router, RSC, Server Actions) |
| Language | TypeScript (strict) |
| Hosting | Railway (app + workers) |
| DB / Auth / Storage / Realtime | Supabase |
| Background jobs | Inngest (default; half-day spike vs Trigger.dev in week 1) |
| UI | Tailwind + shadcn/ui |
| Forms & validation | React Hook Form + Zod |
| AI | Anthropic SDK via internal abstraction |
| Email | Postmark |
| SMS + Voice | Dialpad API |
| E-signature | Dropbox Sign |
| Payments | Confido |
| Errors | Sentry |
| Logs | Axiom or Better Stack |

---

## 5. Data Model

All non-global tables have `firm_id` with RLS enforcing tenant isolation.

**Tenancy & Identity**
- `firms` — tenant. LFL is firm #1.
- `users` — linked to Supabase Auth.
- `firm_users` — roles: `owner | attorney | paralegal | assistant | viewer`.
- `firm_config` — key-value: approval modes, model preferences, feature flags, branding.

**Lead & Matter**
- `leads` — raw inbound. Source, contact info, payload, status.
- `contacts` — normalized people. One contact → many matters over time.
- `matters` — the actual legal matter. Primary workflow unit.
- `pipeline_stages` — per-firm stage definitions with SLAs and allowed transitions.
- `matter_stage_history` — every transition with timestamp, actor, reason.

**Classification & Conversation**
- `classifications` — AI classification results, immutable (new = new row).
- `conversations` — one per lead. Phase, context, last AI suggestion, attorney annotations.
- `messages` — inbound/outbound SMS + email. Status, AI-generated flag, approved_by, sent_at.
- `ai_jobs` — every AI call. Model, tokens, cost, latency, purpose, linked entity.

**Fees, Engagement, Payment**
- `fee_schedules` — per-firm per-state per-service pricing with floor prices.
- `fee_quotes` — per-matter quote, status flow, negotiation trail.
- `engagement_letters` — template, variables, PDF, e-sign status, envelope ID, signed_at.
- `invoices` — one-time, amount, status, Confido charge ID, paid_at.

**Drip & Scheduled Actions**
- `drip_campaigns` — campaign definitions.
- `drip_templates` — message variants with A/B metadata.
- `scheduled_actions` — concrete scheduled sends, cancelable on reply.

**Approval & Audit**
- `approval_queue` — anything awaiting approval: entity type, id, priority, SLA.
- `approvals` — decisions. Approved/rejected, by whom, with what edits.
- `audit_log` — append-only, hash-chained. Every state change, AI call, message, approval, integration event.

**Integration State**
- `integration_accounts` — per-firm credentials, encrypted at rest.
- `integration_sync_state` — sync cursors, last-polled timestamps.
- `webhook_events` — raw inbound payloads, stored before processing.

**Jurisdictional Config**
- `jurisdictions` — state-level legal metadata. LFL seeds TX/IA/ND/PA/NJ.

---

## 6. Tenant Isolation

Hybrid multi-tenancy, shared schema with RLS.

- Every non-global table has `firm_id UUID NOT NULL REFERENCES firms(id)`.
- RLS policies: users only see rows where `firm_id` matches their firm.
- Platform-admin role bypasses RLS for support; every bypass audit-logged.
- Integration secrets per-firm, encrypted with per-firm keys derived from a platform KMS root.

**Mandatory CI test: cross-tenant read must fail.** Blocks merge if not present on data-access code.

---

## 7. Approval & Audit Model

**Approval flow:** AI generates outbound artifact → status `pending_approval` → appears in queue → attorney approves/edits/rejects → artifact sent → audit-logged throughout.

**Approval modes** (configurable per action type):
- `always_approve` — v1 default
- `auto_send_with_audit` — auto-sends, sample flagged for review
- `auto_send` — earned

**Three mandatory gates (not overridable):** fee quote, engagement letter, invoice.

**Audit log:** Append-only, hash-chained, insert-only permissions for app/workers. Weekly cold-storage export. Logged: every AI call, every message in/out, every approval, every stage transition, every fee/engagement/payment event, every webhook, every permission-sensitive action.

---

## 8. Integration Strategy

Standard adapter interfaces; core platform never talks to vendors directly.

- `CRMAdapter` — v1 optional (Lawcus adapter if tenant wants it)
- `TelephonyAdapter` — v1: Dialpad
- `EmailAdapter` — v1: Postmark outbound, Gmail poller for LegalMatch inbound
- `PaymentAdapter` — v1: Confido
- `ESignAdapter` — v1: Dropbox Sign
- `AIAdapter` — v1: Anthropic

---

## 9. AI Architecture

**Abstraction:**
```
lib/ai/index.ts
├── classify(lead) → Classification
├── converse(conversation, newMessage) → DraftReply
├── draft(template, variables, context) → Draft
└── judgment(question, context) → Decision
```

Each function: looks up tenant's model preference, applies ZDR flag if privileged, logs to `ai_jobs`, returns Zod-validated response, degrades gracefully on rate limit.

**Default routing (v1):**
| Task | Model |
|---|---|
| Lead classification | Haiku 4.5 |
| Conversation replies | Sonnet 4.6 |
| Fee negotiation edge cases | Sonnet 4.6, escalate to Opus 4.7 on complexity signals |
| Objection classification | Haiku 4.5 |
| Engagement letter draft | Sonnet 4.6 |
| Privileged content | Same models, ZDR endpoint |

**ZDR:** Task-level `privileged: true` flag routes to ZDR endpoint, logs metadata only.

---

## 10. Security & Compliance

- **Auth:** Supabase Auth, magic link + TOTP MFA required for non-viewer roles.
- **Authz:** Roles + RLS + action-layer checks. Defense in depth.
- **Secrets:** Envelope encryption, per-firm keys.
- **PII:** Fields flagged in schema. Export and deletion capabilities in v1.
- **Audit log:** Hash-chained, weekly cold-storage export.
- **Backups:** Supabase daily, 30-day retention. Weekly automated restore verification.
- **Staging:** Separate projects, synthetic data only.
- **Network:** HTTPS, signed webhooks, pooler IP allowlist where possible.

---

## 11. Observability

1. Errors → Sentry
2. Logs → Axiom or Better Stack (structured JSON)
3. Metrics → built-in dashboards: funnel depth, approval queue depth, AI cost per firm, SLA breaches

---

## 12. Deferred

- Document generation + triple-verify (v2)
- Post-delivery automation (v2)
- Full website intake form (v2-3)
- Voice AI for inbound calls (v3+)
- Second CRM adapter beyond Lawcus (v3)
- Admin UI for editing tenant config (v3)
- LPW patent wing (v4+)
- Cohort analytics (v3)
- Self-learning autonomy ramp (v3)

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Timeline tight | Disciplined scope. Cut list in sprint plan. |
| Garrison is sole source of business logic | Front-load his input in week 1 via structured session. |
| RLS misconfig leaks tenant data | Mandatory cross-tenant test in CI. |
| AI cost blowout | Per-firm ceiling, alert at 80%, hard stop at 120% with override. |
| Integration breakage | Per-adapter contract tests, failures isolated to one channel. |
| Confido API quirks | Budget one day for unknown webhook behavior. |

---

## 14. Decision Log

- Platform is source of truth, not any CRM. [2026-04-21]
- Hybrid multi-tenancy, shared DB, RLS. [2026-04-21]
- Railway + Supabase + Postmark + Dialpad + Confido + Dropbox Sign. [2026-04-21]
- AWS deferred; add only when needed. [2026-04-21]
- Three mandatory approval gates: fee quote, engagement letter, invoice. [2026-04-21]
- Attorney is liable; platform is tooling. [2026-04-21]
- Tamper-evident audit log from day one. [2026-04-21]
- LFL first; LPW deferred to v4+. [2026-04-21]
- Document generation is v2. [2026-04-21]
- Tenant config in database, not code. [2026-04-21]
- AI abstraction from day one; models are config values. [2026-04-21]
- Confido stays in v1; LawPay adapter added when a tenant requests it. [2026-04-22]
- Building from scratch; no migration. [2026-04-22]
