# CLAUDE.md — Project Context

This file is read by Claude Code at the start of every session. It defines the project, the rules, and how to work effectively on this codebase.

---

## Project: Legal OS (v1 of Peregrine)

**What we're building:** A vertical AI intake and sales platform for law firms. v1 is for Legacy First Law (LFL), an estate planning practice. Multi-tenant from day one; one live tenant in v1.

**The longer term:** Peregrine. A horizontal platform for vertical AI ops across industries. LFL is instance #1. Keep the architecture clean so additional verticals are additions, not rewrites.

**The five abstractions that define Peregrine:**
1. Intake — multi-channel lead capture and qualification
2. Agent conversation — configurable qualification and routing
3. Work product generation — templated AI drafts (v2+)
4. Human approval — review queue with audit trail
5. Delivery — multi-channel send with tracking

**v1 scope (8 weeks):** Lead arrives → AI qualifies and converses → attorney approves outbound → fee quoted → engagement letter signed → invoice paid → matter marked `READY_FOR_PRODUCTION`.

**Out of scope for v1:** Document generation, triple-verify, attorney document review, delivery automation, patent practice, post-delivery workflows. These are v2+. **Do not build them.**

---

## How to work on this codebase

### Read the docs first
Before doing any real work, read these:
- `/docs/01_ARCHITECTURE.md` — technical blueprint, data model, AI abstraction, security model
- `/docs/02_SPRINT_PLAN.md` — week-by-week plan with slip strategy
- `/docs/03_GARRISON_SESSION.md` — the business logic extraction (contents populated as the firm owner is interviewed)

Decisions in these docs are not hypotheticals. They were argued out. If you think a decision is wrong, raise it explicitly — don't silently override it.

### Propose before executing
For anything non-trivial:
1. State what you understand the task to be.
2. Propose the plan (files to create/modify, migrations, tests).
3. Wait for approval.
4. Execute.
5. Report what you did and what remains.

For trivial changes (a typo, a variable rename, an obvious bug fix), just do it and note it.

### Commits and PRs
- Commit in logical units. One concern per commit.
- Meaningful commit messages. Not "update code" or "fix stuff."
- Never push to `main` directly. Always open a PR.
- Every schema change = a new migration file. Never modify the database through dashboard clicks.
- PR descriptions include: what changed, why, what's tested, what the reviewer should look at first.

### Ask when ambiguous
If a decision has downstream consequences (schema shape, API contract, security model), ask. If it's a judgment call with low blast radius (variable naming, test organization), just pick and note it in your PR description.

---

## Non-negotiables

These are the rules that don't bend. If you're about to violate one, stop.

### 1. Tenant isolation
Every non-global table has `firm_id`. RLS policies enforce tenant isolation at the database. Every PR touching data access code must include a test that proves cross-tenant reads fail. CI enforces this — the test must pass for the PR to merge.

A cross-tenant data leak is the worst possible bug this platform can have. Treat every data access path with appropriate paranoia.

### 2. Audit log integrity
The `audit_log` table is append-only, hash-chained. Every meaningful state change lands in it. You cannot update or delete rows; database rules prevent it.

Hash computation: `hash = sha256(prev_hash || action || entity_type || entity_id || before || after || created_at)`. Use a server-side function for inserts; never let the app compute the hash directly.

### 3. Approval gates
Three actions always require attorney approval, regardless of any other config:
- Sending a fee quote to a client
- Sending an engagement letter to a client
- Sending an invoice to a client

Do not add a way to bypass these. They are hard-coded gates, not configurable.

### 4. Secrets handling
- Never commit `.env`, `.env.local`, or any file with real credentials.
- Never paste credentials into code or comments.
- Per-firm integration credentials are encrypted at rest in `integration_accounts` using per-firm keys.
- Service role keys are server-only. Never exposed to the browser (no `NEXT_PUBLIC_*` for secrets).

### 5. AI abstraction
All AI calls go through `lib/ai/*`. Never call the Anthropic SDK directly from route handlers or components. Every AI call logs to `ai_jobs` with model, tokens, cost, purpose.

### 6. No vertical-specific strings in core
This project will grow beyond estate planning. Core code should never reference "estate planning," "wills," "trusts," "TX bar rules," or specific matter types. These live in:
- Tenant config (`firm_config` table)
- Vertical modules (eventual `/packages/verticals/estate-planning` — not required in v1 repo layout, but name things generically as if it existed)
- Seed data scripts

Core types: `Lead`, `Matter`, `PipelineStage`, `FeeQuote`, `Conversation` — not `EstatePlanningMatter`.

### 7. Scope discipline
If something belongs in v2 (document generation, triple-verify, delivery, post-delivery), it belongs in v2. Don't slip it in "because it's quick." Flag it as a future task in the appropriate tracking doc.

---

## Tech stack (reference)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, Server Components, Server Actions) |
| Language | TypeScript strict |
| Hosting | Railway |
| DB / Auth / Storage / Realtime | Supabase |
| Background jobs | Inngest (default; may revisit in week 1) |
| UI | Tailwind + shadcn/ui |
| Forms & validation | React Hook Form + Zod |
| AI | Anthropic SDK via `lib/ai/` abstraction |
| Email | Postmark |
| SMS + Voice | Dialpad |
| E-sign | Dropbox Sign |
| Payments | Confido |
| Errors | Sentry |
| Logs | Axiom |

**Default AI models (v1):**
- Lead classification: Haiku 4.5
- Conversation replies: Sonnet 4.6
- Fee negotiation edge cases: Sonnet 4.6 → escalate to Opus 4.7 on complexity signal
- Privileged content: same models via ZDR endpoint

Model choice is a config value per tenant per task. Never hardcode model strings in business logic.

---

## Data model overview

Short reference. Full details in `/docs/01_ARCHITECTURE.md` §5.

- **`firms`** — tenants
- **`users`, `firm_users`** — identity and roles
- **`firm_config`** — per-firm key/value config
- **`leads`, `contacts`, `matters`** — core business entities
- **`pipeline_stages`, `matter_stage_history`** — pipeline
- **`classifications`, `conversations`, `messages`, `ai_jobs`** — AI and communication
- **`fee_schedules`, `fee_quotes`, `engagement_letters`, `invoices`** — money
- **`drip_campaigns`, `drip_templates`, `scheduled_actions`** — drip engine
- **`approval_queue`, `approvals`** — approval workflow
- **`audit_log`** — append-only, hash-chained
- **`integration_accounts`, `integration_sync_state`, `webhook_events`** — integrations
- **`jurisdictions`** — state-level legal metadata

Every non-global table has `firm_id` with RLS enforced.

---

## File layout
/
├── CLAUDE.md                    (this file)
├── .env.local                   (NOT committed — secrets)
├── .env.example                 (committed — template)
├── next.config.js
├── package.json
├── tsconfig.json
├── /docs/                       (architecture, sprint plan, session notes)
├── /src/
│   ├── /app/                    (Next.js App Router)
│   ├── /components/             (React components, shadcn/ui)
│   ├── /lib/
│   │   ├── /ai/                 (AI abstraction; classify, converse, draft, judgment)
│   │   ├── /audit/              (audit log insert function with hash chain)
│   │   ├── /supabase/           (server and client Supabase clients)
│   │   ├── /adapters/           (integration adapter interfaces)
│   │   └── /integrations/
│   │       ├── /dialpad/
│   │       ├── /postmark/
│   │       ├── /confido/
│   │       ├── /dropbox-sign/
│   │       └── /gmail/
│   └── /types/                  (shared TypeScript types, Zod schemas)
├── /supabase/
│   └── /migrations/             (SQL migrations, numbered 00001_, 00002_, ...)
└── /tests/
    ├── /rls/                    (mandatory RLS tests)
    ├── /adapters/               (integration adapter contract tests)
    └── /e2e/                    (future — end-to-end flows)

---

## Sprint rhythm

Each sprint week has a clear scope in `/docs/02_SPRINT_PLAN.md`. Current week is tracked in `/docs/CURRENT.md` (created at start of week 1).

**Don't start next week's work until this week's is merged and verified.** If this week finishes early, that's buffer — don't burn it on next week's scope.

**If this week slips:** apply the slip strategy in the sprint plan. Cut from the bottom of the priority list, don't skip safety/testing/audit requirements.

---

## When to escalate

Ask the human (product owner) when:
- A decision affects the data model in a way that would be painful to reverse.
- A decision changes the security model or tenant isolation.
- A vendor API behaves differently from what you expected and the workaround isn't obvious.
- The firm owner (Garrison) has provided business logic that contradicts something in the docs.
- Cost is trending higher than expected (per-firm AI spend > $200/month in v1 development is a flag).
- A test is failing in a way you can't explain.

Don't ask when:
- Variable naming, test file organization, minor refactors.
- Adding a widely-used dependency that's obviously appropriate.
- Fixing a typo or obvious bug.
- Choosing between two equally-good implementations of an internal function.

---

## Long game reminders

- **This becomes Peregrine.** Write core code that will survive the transition.
- **Other law firms will run on this.** Write code that will survive white-label onboarding.
- **Other industries will run on this.** Keep vertical logic in config and modules, not hardcoded.
- **Real clients depend on this.** Attorneys rely on it. Bugs cause real harm.

The right mindset is: "I'm building a product, not a prototype." Test coverage, error handling, observability, audit trails, security — these are features, not afterthoughts.

---

## Versioning this file

When you change this file, note the reason in the PR. The rules here evolve as the project learns. Dated decision entries can go at the bottom if useful.

Last significant update: project initialization (Week 1).
