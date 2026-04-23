# Legal OS — Sprint Plan

**Goal:** Ship LFL's lead-to-paid-engagement workflow in ~8 weeks. Multi-tenant-ready from day one. At week 8, Garrison is running his practice on the new platform.

**Exit criteria:** LegalMatch + NonStop + Dialpad inbound → new system. Attorney approves all outbound via Command Center. Fee quotes, engagement letters, invoices flow through the platform. Clients sign via Dropbox Sign and pay via Confido. Matters land in `READY_FOR_PRODUCTION` with complete data.

**Planning notes:**
- No migration — we're building clean, not porting.
- Garrison is the single source of business logic. His input is the critical path.
- Buffer is real. Weeks end early when they can.
- Staging environment stays in sync with main throughout.

---

## Week 1 — Foundation (tight, 2-3 days of real work)

- GitHub repo, Railway projects (app + staging), Supabase projects (prod + staging), Sentry, logs.
- Next.js 15 app scaffolded: TypeScript strict, Tailwind, shadcn/ui, Supabase client, Anthropic SDK, Zod, React Hook Form.
- Inngest vs Trigger.dev: half-day spike on whichever looks better from docs, pick and move on.
- Supabase Auth wired (magic link, TOTP MFA for non-viewer).
- Core schema: `firms`, `users`, `firm_users`, `firm_config`, `audit_log`. RLS policies written and tested.
- CI: mandatory cross-tenant read test. Blocks merge.
- Seed script: LFL as firm #1, Garrison as owner.
- Health-check endpoint, Sentry confirmed, logs flowing.
- **The business logic extraction session with Garrison.** 60-90 minutes with you interviewing, me transcribing/extracting. Produces the spec for weeks 2-6.

**Exit:** Shell deploys on git push, auth works, RLS tests pass, LFL seeded, business logic session complete.

**Remaining capacity in week 1:** Start week 2 work early if foundation goes fast.

---

## Week 2 — Lead Ingestion + Classification

- Schema: `leads`, `contacts`, `classifications`, `integration_accounts`, `integration_sync_state`, `webhook_events`.
- Lead Intake Service: normalize, dedupe (email + phone fuzzy match), DNC check.
- LegalMatch Gmail poller (worker, 60s interval). Parses Parseur emails, creates leads.
- NonStop webhook endpoint, signed.
- Dialpad inbound webhook for SMS, signed.
- Manual lead entry form (basic admin UI).
- Classification worker: on new lead, `ai.classify()` with Haiku 4.5, store `classifications`, update lead.
- Audit log entries for every lead + classification.

**Exit:** New leads from all three sources land in Postgres with classifications. Test lead in LegalMatch shows up within 60s with classification.

---

## Week 3 — Conversation Engine + Approval + Messaging

**The hardest week. Respect it.**

- Schema: `conversations`, `messages`, `approval_queue`, `approvals`.
- Conversation state machine: phase tracking, context, last AI suggestion, attorney annotations.
- `ai.converse()`: Sonnet 4.6 with tenant system prompt + conversation history + classification context → draft reply.
- Approval queue UI (first cut): list of pending drafts, approve / edit+approve / reject, priority-sorted.
- Outbound dispatch:
  - Dialpad `sendSMS()` — Garrison's number, wired to adapter
  - Postmark `send()` — for longer replies or email-appropriate content
- Inbound SMS processing: Dialpad webhook → find lead by phone → append to conversation → enqueue draft.
- Inbound email processing: Gmail poller → conversation → enqueue draft.
- Approval mode config per action type, all defaulted to `always_approve`.
- Audit log: every draft, approval, edit, send.

**Exit:** Lead texts the system, draft appears in Command Center, Garrison approves, reply goes out from his Dialpad number.

---

## Week 4 — Pipeline + Drip + Command Center v1

- Schema: `matters`, `pipeline_stages`, `matter_stage_history`, `drip_campaigns`, `drip_templates`, `scheduled_actions`.
- Pipeline manager: LFL's stages seeded from Garrison's session output. Transitions with validation (required fields, allowed sources, SLAs). History logged.
- Drip engine:
  - Templates seeded from Garrison's session output.
  - Scheduler creates `scheduled_actions` on relevant stage transitions.
  - Worker generates message from template at scheduled time, enqueues for approval.
  - **Pause-on-reply:** inbound message cancels pending drips.
  - A/B variant selection.
- Command Center v1:
  - Pipeline funnel with real-time counts (Supabase realtime).
  - Lead/matter list, filterable by stage.
  - Lead detail: full timeline (messages, stage changes, AI calls, approvals).
  - Approval queue (wk 3) integrated.
  - Placeholder for fee calculator (wk 5).

**Exit:** Garrison can open Command Center, see his pipeline, drill into a lead, review timeline, approve pending messages. Drips fire on schedule.

---

## Week 5 — Fees + Engagement + Competitor Playbook

- Schema: `fee_schedules`, `fee_quotes`, `engagement_letters`, `playbook_entries`.
- Fee schedule seeded from Garrison's session output (per-state, per-service, floor).
- Fee calculator in Command Center — live computation, list + floor, negotiation tracking.
- Fee quote generation:
  - AI-assisted draft using classification + matter type + state + objection context.
  - **Mandatory approval gate #1.** Approved quote sent via SMS or email. Status flow tracked.
- Competitor playbook seeded. Surfaced contextually in Command Center when objection detected.
- Call script data-driven from tenant config, rendered in Command Center.
- Engagement letter workflow:
  - Per-state templates from Garrison.
  - Variables filled from matter data.
  - PDF generated.
  - Dropbox Sign adapter creates envelope.
  - **Mandatory approval gate #2.** On send, client gets e-sign link.
  - Dropbox Sign signature webhook updates matter, triggers invoice.

**Exit:** Garrison fee-quotes a lead, quote goes out after approval, if accepted engagement letter is generated, sent, signed.

---

## Week 6 — Payments + UAT + Hardening

- Schema: `invoices`.
- Invoice generation on engagement letter signed.
- **Mandatory approval gate #3.**
- Confido integration: create payment, send payment link.
- Confido webhook on payment received → mark invoice paid → matter transitions to `PAYMENT_RECEIVED` → `READY_FOR_PRODUCTION`.
- IOLTA routing: earned-on-receipt vs trust deposit per state config.
- **UAT with Garrison (2-3 days):**
  - Synthetic leads end-to-end.
  - He runs his real workflow against the new system.
  - Bug list + UX list.
- Hardening: fix UAT findings.
- Cost tracking dashboard per firm.
- Light load test.

**Exit:** Synthetic end-to-end works cleanly. Garrison has tried it and signed off.

---

## Week 7 — Go-Live

Since there's no migration to unwind, go-live is simpler than it would otherwise be.

- **Day 1:** Final UAT fixes. Production credentials verified. Monitoring dashboards confirmed working.
- **Day 2:** LegalMatch email polling repointed to new system. First real leads start flowing. Watch logs closely.
- **Day 3:** NonStop webhook repointed.
- **Day 4:** Dialpad inbound SMS repointed.
- **Day 5:** Garrison runs a full day in the new system. End-of-day retro with you.
- **Days 6-7:** Fix anything surfaced by real usage. Buffer.

**Exit:** All lead sources flowing through new system. Garrison is running his practice on the platform.

---

## Week 8 — Stabilize + v2 Kickoff

- Fix anything week 7 surfaced.
- Backup restore verification (automated test to staging).
- Runbooks: Dialpad down, Supabase outage, approval queue overflow, deploy rollback.
- Cost model review.
- Audit log chain validated end-to-end.
- Retrospective with Garrison.
- **v2 kickoff:** document generation pipeline scoping.
- If week 7 surfaced a lot, this week absorbs it. If it didn't, we're already starting v2.

**Exit:** Platform is stable and boring. v2 scope defined.

---

## Dependency Map — what Garrison owes us, and when

Garrison's input is the critical path. If these are late, the sprint slips.

| Week | From Garrison |
|---|---|
| 1 | Business logic extraction session (60-90 min). LegalMatch/NonStop/Dialpad credentials. |
| 2 | Confirm fee schedule structure he gave us, state rules. |
| 3 | Sample conversations (5-10 anonymized), tone/voice preferences, red-flag signals. Confido credentials. |
| 4 | Drip templates confirmed or revised. Pipeline stage SLAs confirmed. |
| 5 | Engagement letter templates per state. State-specific disclosures. Dropbox Sign access. |
| 6 | 2-3 days of UAT focus. IOLTA routing decisions per state. |
| 7 | Presence during go-live. Willingness to flag issues in real time. |

---

## Slip Strategy

Cut from the bottom:

1. **Keep (never cut):** Lead ingest, classification, conversation engine with approval, pipeline, Command Center core, fee quote, engagement letter, invoice + payment.
2. **Cut if needed:** A/B drip variants (ship single best per day), competitor playbook UI polish (keep data, simpler UI), call script UI polish.
3. **Cut early if slipping:** Multi-variant drip entirely (1 template per day offset), cohort analytics, Lawcus bidirectional sync.

If 2+ weeks behind by end of week 4, replan. Extend to 10 weeks or cut harder. Don't ship broken software.

---

## After Week 8

- **v2 (weeks 9-16):** Document generation, triple-verify, attorney document review, delivery automation.
- **v2.5 (weeks 17-20):** Post-delivery (satisfaction, reviews, referrals, annual review).
- **v3 (weeks 21-28+):** White-label readiness — admin UI, Clio adapter, first external tenant.
- **v4+:** LPW patent wing, broader Legal OS.
