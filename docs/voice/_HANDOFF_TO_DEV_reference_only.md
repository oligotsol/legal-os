# Handoff — Intake Closer Prompt System → Architect / Dev (Danny)

**From:** Garrison English (founder), via assist
**To:** Danny Meisselman (Chief AI Officer / dev lead) + architect
**Subject:** Wiring the new phone-first Intake Closer prompts into production
**Date:** 2026-05-05
**Status of work:** prompts complete, engine v112 live in production, dev work needed
to wire prompts into the conversation engine

---

## TL;DR

There's a folder of 11 prompt files in
`/lfl-build/01_SYSTEM_PROMPTS/intake_correspondence/` that captures the new
phone-first, quote-immediate, approval-gated intake doctrine. The conversation
engine (`lfl-ai-05-conversation-engine`, deployed v112) currently uses an inline
async-only prompt baked into `Code.js:getBaseSystemPrompt()` (~line 1860). Two ways
to bridge that gap; my recommendation is a 3-phase rollout, not a binary choice.

**Phase 1 (this week):** drop-in replacement of `getBaseSystemPrompt()` body. Ships
the doctrine now. One Code.js edit + one `clasp push`.

**Phase 2 (~2 weeks):** add a Drive-fetched prompt loader with caching + cache-bust
endpoint. Decouples prompt iteration from `clasp` cycles.

**Phase 3 (~4-6 weeks):** proper prompt registry — versioned, A/B-able, telemetered.
This is the long-term home.

The rest of this document is everything Danny needs to scope each phase.

---

## What's been delivered (read this first)

```
lfl-build/01_SYSTEM_PROMPTS/intake_correspondence/
├── 00_ROLE_LOCK_INTAKE_CLOSER.md       ← Garrison's locked doctrine
├── 00_README.md                         ← orientation + integration notes
├── 01_master_system_prompt.md           ← the executable system prompt (source of truth)
├── 02_execution_template.md             ← input/output contract
├── 10_state_playbooks.md                ← S1-S6 client states + actions
├── 20_qualification.md                  ← MVQ (Estate + Business)
├── 30_pricing.md                        ← flat-fee schedule + bundles + rush
├── 40_state_notes.md                    ← TX/IA/ND/PA/NJ specifics + IOLTA
├── 50_objections.md                     ← 8-category objection playbook
├── 60_micro_scripts.md                  ← copy-paste reference scripts
├── 99_output_format.md                  ← strict output rules + validation
└── _archived_async_only_pre_2026-05-04/ ← prior system, superseded
```

**Total: ~3,000 lines, all in version-controlled Markdown.** No code, no JSON, no
YAML — pure copy + structure. Designed to be readable by Garrison without engineering
help and parsable by an LLM at runtime.

The file `01_master_system_prompt.md` is the canonical system prompt. Everything in
`10_*` through `60_*` is reference material the LLM pulls in on demand (per the
"Reference files" section in `01`).

---

## Production state today (what's already shipped)

### Conversation engine (`lfl-ai-05-conversation-engine`)
- Deployment: `AKfycbxlEuQpBIAmTFtoz9WxfIYLAEBrVTQ6MeHJeKWQmpqCUx5rz-kSRxWisODX_0tLRas`
- Current version: **v112 @ deployment 115**
- v112 includes the v2-audit fixes: MASTER_OUTBOUND_KILL gate, `k=` auth on
  `?action=approve` and `?action=approve_all`, stage-aware ethics checker, strict
  `lookupFee` (returns null on miss instead of silent first-sub-category fallback),
  `is_work_authorized` engagement gate, `authorize_work` event, `register_lead`
  honors `classification.stage` (whitelist-checked).

### Locked Script Properties

| Property | Value | Reason |
|---|---|---|
| `SMS_SAFE_MODE` | `1` | HARD RULE 2026-04-28 — SMS hard-blocked at `sendSms` |
| `AUTO_APPROVE_DISABLED` | `1` | No cron auto-send |
| `WINBACK_DISABLED` | `1` | Win-back cron paused |
| `CROSS_SELL_DISABLED` | `1` | Cross-sell cron paused |
| `EMAIL_SAFE_MODE` | (cleared) | Email is allowed |
| `MASTER_OUTBOUND_KILL` | (cleared) | Top-level kill not engaged |
| `LFL_TEST_MODE_GLOBAL` | (cleared) | Was QA-only |

### Smoke-test verified live (2026-04-30)
- 3/3 auth gates rejecting unauthenticated `approve` / `approve_all` / wrong-`k=`
- 6/6 MASTER_OUTBOUND_KILL toggle test cases
- Engagement gate full flow: register → engagement_sent (refused) → authorize_work
  (persists via `garrison_flags_json`) → engagement_sent (succeeds → ENGAGEMENT_SENT)
- `register_lead` with `stage=REFERRED_AMICUS_LEX` lands at REFERRED_AMICUS_LEX
  (was previously hardcoded to FIRST_TOUCH)

### What's still blocked
- **Lawcus API.** All 11 generated bearer tokens return HTTP 401. Sidra at Lawcus is
  in-flight — last reply 2026-04-29 asking for OAuth redirect URL. Garrison drafted
  a follow-up in Gmail Drafts (id `r-978469755363678444`) with both the standard
  Apps Script callback URL and clarifying questions about Lawcus's actual auth model
  (OAuth vs bearer). **Open.**
- **Dashboard `manual_stage_update` bypass of engagement gate.** Discovered during
  v2 audit. The dashboard's "Send engagement letter" button calls
  `manual_stage_update` to advance to ENGAGEMENT_SENT, which bypasses the
  `is_work_authorized` gate that protects the `event:engagement_sent` path. Two
  options: (a) gate `manual_stage_update` to ENGAGEMENT_SENT behind the same auth
  flag, or (b) refactor the dashboard button to fire the event instead. **Open.**

---

## Recommended phasing

### Phase 1 — drop-in replacement (this week)

**What:** copy the SYSTEM PROMPT block from `01_master_system_prompt.md` into
`Code.js:getBaseSystemPrompt()`, replacing the inlined async-only doctrine.

**Why first:** unblocks the doctrine immediately. Every existing call path
(`generateFirstTouch`, `generateReplyResponse`, etc.) consumes whatever
`getBaseSystemPrompt()` returns, so swapping the body propagates the new doctrine
across every call without touching any of the call sites.

**Touch surface:** 1 file (`Code.js`), 1 function. Estimated 30-60 minutes including
clasp re-auth.

**Risk:** the existing `generateFirstTouch`/`generateReplyResponse` user-prompt
templates were tuned to the OLD doctrine. With the new system prompt they may produce
slightly off-tone outputs in the first few generations until the user-prompt
templates are also updated. Mitigation: the engine already buffers everything for
human approval (`SMS_SAFE_MODE=1` + `AUTO_APPROVE_DISABLED=1`), so any tone misses
get edited at the approval step. Drift in the first 24 hours is observable, not
shippable.

**Open question for the team:** in `getBaseSystemPrompt()`, do we want the new
intake-staff persona (Casey + LFL Intake Team) to be parameterized via a Script
Property `INTAKE_STAFF_NAME` so different paralegals can be set as the closer
without a code change? My vote: yes, ship it parameterized.

### Phase 2 — Drive-fetched loader with caching (~2 weeks)

**What:** modify `getBaseSystemPrompt()` once to fetch
`01_master_system_prompt.md` from Drive at runtime. Cache result in Apps Script
`CacheService` (6-hour max TTL) backed by `Script Properties` (warm fallback
indefinitely). Add `?action=reload_prompts&k=...` to bust cache on demand. On any
fetch failure, fall back to `Script Properties` last-known-good; if THAT fails,
fall back to a hardcoded shipping value (a copy of v1 of the prompt baked into
the code).

**Why phase 2 not phase 1:** prompt iteration without `clasp push` is the actual
unlock. Once it's working, Garrison edits the `.md` and the change takes effect
within `?reload_prompts` or 6h, no engineering bottleneck.

**Touch surface:**

```
Code.js:
  - getBaseSystemPrompt() — refactor to call _loadPromptFromDrive_() with cache
  - _loadPromptFromDrive_(name) — new helper, fetch + cache
  - _reloadPromptCache_() — new helper, busts cache
  - doGet() — new ?action=reload_prompts handler

Script Properties:
  - INTAKE_PROMPT_DRIVE_FILE_ID = <Drive file ID for 01_master_system_prompt.md>
  - INTAKE_PROMPT_LAST_GOOD = (auto-written by loader, last successful fetch)
```

**Risks:**

1. **Drive read latency** — adds ~200-500ms to first request after cache miss.
   Acceptable for human-paced intake (engine is async anyway). Cache hit is free.
2. **Drive API quota** — Apps Script has a 100M characters/day Drive read quota at
   the user level. With 6-hour cache TTL we'll do ≤4 fetches/day total. Not a
   constraint.
3. **Drive permission drift** — if the prompt file gets moved or perms change,
   loader fails. Hence the `Script Properties` warm fallback + hardcoded fallback.
4. **Cache poisoning during deploy** — if a bad prompt edit lands and the cache
   serves it, traffic gets the bad prompt for up to 6h or until manual reload.
   Mitigation: human approval gate catches everything before send anyway, so the
   blast radius is "drafts look weird, approver edits them" — not "bad messages
   ship."

**Open question:** prompts in Drive are convenient for non-engineers; prompts in
Git (this repo) are convenient for engineers. Recommend: keep Git as source of
truth, push to Drive via a `scripts/sync-prompts-to-drive.sh` helper that mirrors
the folder. Garrison edits in either place; the helper resolves drift on each
push. Dev team reviews PRs in Git; prod consumes from Drive.

### Phase 3 — proper prompt registry (4-6 weeks)

**What:** replace the single-file Drive read with a proper registry. Each prompt
gets:

- A **stable name** (`intake_closer_master_system_prompt_v3`)
- A **semver** (1.0.0, 1.1.0, …)
- A **prompt-version field** stored in `messages_json` per generated message
- An **A/B variant** (`intake_closer_master_system_prompt_v3:variant_a`,
  `:variant_b`) — engine selects variant by hash(lead_id)
- **Outcome telemetry** — for every prompt-generated message, log
  `{prompt_name, prompt_version, prompt_variant, message_id, lead_id,
  delivered_at, replied_at, converted_at, conversion_value}` to a `PromptTelemetry`
  sheet
- A **rollback control plane** — Script Properties + admin endpoint to pin a lead
  cohort to v1 if v2 underperforms

**Why this is the actual long-term home:** prompts are content. Content has
versioning, A/B testing, and telemetry needs. Today they don't have any of those —
we ship blind.

**Touch surface:** new module (`PromptRegistry.gs`), new sheet (`PromptTelemetry`),
new admin endpoints (`?action=prompt_registry_*`), modifications to all generation
functions to accept a prompt-version parameter. Estimate 2-3 dev weeks.

**Open question:** does Danny want this owned by the conversation engine codebase
or factored into a separate Apps Script project / web service? My vote: same
codebase for v1 of the registry; factor out only if multi-firm reuse becomes a
real requirement (LFL → Amicus Lex → LPC → Field Vector — those four projects
all need their own intake prompts, but the registry pattern is identical).

---

## Five architectural decisions Danny needs to weigh in on

### 1. Source of truth — Git, Drive, or both?

The prompts live in Git today (`/lfl-build/01_SYSTEM_PROMPTS/intake_correspondence/`).
Phase 2 needs them in Drive for the engine to fetch. Three options:

- **(a)** Git only, generate the prompt file at clasp-push time and bake into Code.js (Phase 1 forever)
- **(b)** Drive only, abandon Git for prompts, accept the lack of code review
- **(c)** Both — Git is source of truth, sync-script pushes to Drive on `git push`

My vote: **(c).** Engineers get review + history; non-engineers get edit velocity.
Sync drift is detectable via a simple checksum check.

### 2. Approver UX — current Command Center or new dashboard?

The phone-first doctrine plus the approval gate means an approver clicks "Approve
& Send" 50-200x/day in a high-volume scenario. The current Command Center
(`AKfycbzLr0p0baF6oiZMi3bfY4MvBuYN29ILgxHDUWK2q6Hp5BBvHkhSiOO2PBwCLxsSR2ybHQ`)
displays drafts but has no batch-approval, no diff-view of edits, no keyboard
shortcuts.

**Decision:** is approval-UX upgrade in scope for the dev team in the next 30
days, or is the current button-per-draft sufficient until volume forces an
upgrade?

My vote: **batch + keyboard-shortcut upgrade is high ROI.** A paralegal approving
50 drafts/day at 30s each = 25 minutes; with batch + j/k navigation +
A=approve / E=edit / R=reject = 5 minutes. 4x productivity for one dev-week of
work.

### 3. Telemetry — start logging now or wait for Phase 3?

Even at Phase 1, the engine could write
`{prompt_version: "v3-phase-1", generated_at, lead_id, conversion_at_t+7d}` to a
sheet. Without it we ship blind for the next 4-6 weeks until Phase 3.

**Decision:** is logging "what prompt version produced this message" worth doing
in Phase 1?

My vote: **yes, just the version string for now.** A two-line `Logger.log` plus
a sheet append. Costs ~5 minutes of dev time, saves us from the "we have no idea
which prompt version was producing the bad messages" debugging hell in 4 weeks.

### 4. Phone-first means call infrastructure has new weight

The doctrine pivots from async-only to phone-first. Concrete implications for the
Dialpad-side stack:

- **Click-to-call from Command Center** — already implemented (`?action=click_to_call`),
  used today, but currently triggers Dialpad to ring Garrison's primary line. With
  intake staff (not Garrison) as the closer, the click-to-call needs to ring the
  approver's Dialpad number instead.
- **Local Presence pool** — Garrison has 9 numbers across 5 states (`DIALPAD_AUDIT_2026-04-11.md`).
  When intake staff calls a TX lead, are they showing TX caller-ID or staff line?
  Local Presence is currently OFF on Garrison's account (per audit) — needs to be
  toggled on if state-matched outbound is the play.
- **Scheduling** — the closer says "5–10 minutes now or later today." Now =
  immediate click-to-call. Later = need a scheduling primitive. Currently there's
  no Calendly equivalent in the stack. Options: (a) add lightweight scheduling
  endpoint that creates a Google Calendar event with the lead's email, (b) integrate
  Cal.com or Calendly, (c) keep it manual ("reply with a time").
- **Call-outcome logging** — `?action=log_call` exists in the engine but is
  underutilized. Phone-first doctrine means call outcomes drive stage transitions;
  need a real workflow for "call happened → engagement sent / hold / lost."
- **Recording → transcript → state update** — Dialpad AI auto-transcribes every
  call (verified in audit). The transcripts could feed back into the engine to
  auto-detect stage transitions ("client agreed on call → flip to FEE_AGREED").
  This is a Phase 3 candidate but worth flagging for roadmap.

**Decision:** which of these are in scope for the dev team in the next 30 days?

### 5. SMS readiness — when does `SMS_SAFE_MODE` come off?

The doctrine treats SMS as an active channel (with approval gate). Today it's
hard-blocked. Lifting the lock requires:

- **Confidence the prompts produce safe SMS** — the new prompts are written for
  this; a regression test pass against a curated set of inbound scenarios is
  needed before lifting.
- **Confidence the approval flow catches errors** — current Command Center shows
  drafts; needs a final gate confirming "yes, this exact text, send NOW."
- **TCPA quiet-hours guard verified live** — engine has it, but it hasn't been
  exercised on the new prompts.
- **STOP/opt-out propagation tested** — engine handles STOP detection on inbound,
  but the integration with Dialpad's STOP handling needs a smoke test before live.

**Decision:** what's the gate for `SMS_SAFE_MODE` clearing? Volume threshold?
Time-bound trial period? Explicit Garrison sign-off after N test conversations?

My vote: **explicit sign-off after 20 approver-reviewed SMS drafts pass the
ethics filter without rewrite.** That's a real signal the prompts produce
shippable SMS without human edits, which is the precondition for lifting the lock.

---

## Implementation checklist — Phase 1 (this week)

```
[ ] Re-auth clasp (Garrison's interactive 2FA)
[ ] Pull current Code.js from production
[ ] Replace getBaseSystemPrompt() body with the SYSTEM PROMPT block from
    01_master_system_prompt.md, parameterizing INTAKE_STAFF_NAME via Script Property
[ ] Update generateFirstTouch user-prompt template to match new doctrine
    (call ask + start-now + S1 framing)
[ ] Update generateReplyResponse user-prompt template to match new doctrine
    (S1-S6 detection + 4-step objection handling)
[ ] Optional: add prompt_version logging to messages_json
[ ] node --check Code.js
[ ] clasp push -f
[ ] clasp redeploy --description "v113: phone-first intake closer doctrine + S1-S6 detection + parameterized intake staff persona"
[ ] Smoke test: register a fresh test lead, fire new_lead, inspect generated draft
    for new doctrine markers (call ask, start-now option, intake-staff sign-off)
[ ] Cleanup test lead → DO_NOT_CONTACT
```

Estimated: 90 minutes including smoke test.

## Implementation checklist — Phase 2 (~2 weeks)

```
[ ] Decide source-of-truth pattern (recommend: Git → Drive sync)
[ ] Create scripts/sync-prompts-to-drive.sh
[ ] Add INTAKE_PROMPT_DRIVE_FILE_ID Script Property
[ ] Implement _loadPromptFromDrive_(name) helper
[ ] Implement _reloadPromptCache_() helper + ?action=reload_prompts endpoint
[ ] Refactor getBaseSystemPrompt() to call _loadPromptFromDrive_()
[ ] Add INTAKE_PROMPT_LAST_GOOD warm fallback to Script Properties
[ ] Add hardcoded fallback to Code.js (last-known-good as a constant)
[ ] Test: edit prompt in Drive → call reload_prompts → verify next generation uses new
[ ] Test: simulate Drive read failure → verify fallback to Script Properties
[ ] Test: simulate Script Properties miss → verify fallback to hardcoded
[ ] Document in 00_README.md the new edit flow for Garrison
```

Estimated: 1 dev-week.

## Implementation checklist — Phase 3 (~4-6 weeks)

```
[ ] PromptRegistry.gs module
[ ] PromptTelemetry sheet schema
[ ] Variant routing by hash(lead_id) → A/B
[ ] Outcome telemetry: delivered_at, replied_at, converted_at, conversion_value
[ ] Admin endpoints: prompt_registry_list, prompt_registry_pin, prompt_registry_rollback
[ ] Outcome dashboard (sheet pivot or Looker Studio panel)
[ ] Documentation: how to add a new prompt, how to A/B test, how to roll back
```

Estimated: 2-3 dev-weeks.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| New prompts produce bad SMS in initial generations | Medium | Low (SMS_SAFE_MODE=1 catches) | Approval gate; lift `SMS_SAFE_MODE` only after 20 clean drafts |
| Phase 2 Drive read fails in prod | Low | Medium (engine couldn't generate) | Warm fallback to Script Properties + hardcoded last-known-good |
| Approver UX bottlenecks at higher volume | High at >100/day | Medium (slows pipeline) | Phase 2 batch-approval upgrade |
| Phone-first ramp creates call volume Garrison/staff can't sustain | Medium | High (worse UX than no call) | Set explicit call-volume cap per day; queue overflow to start-now path |
| Lawcus API stays down | Already realized | Medium (Lawcus writeback frozen) | Continue manual writeback; in-flight with Sidra |
| `clasp` RAPT lock recurs frequently | High (already happens daily) | Low | Phase 2 unblocks iteration without `clasp` |
| Telemetry not in place pre-Phase 3 | High | Medium (blind to which prompts work) | Cheap log-version-string in Phase 1 mitigates 80% |

---

## Files Danny should read in order

1. `00_ROLE_LOCK_INTAKE_CLOSER.md` — Garrison's doctrine (3 minutes)
2. `00_README.md` — orientation (3 minutes)
3. `01_master_system_prompt.md` — the actual prompt (10 minutes)
4. `02_execution_template.md` — the I/O contract (5 minutes)
5. `99_output_format.md` — validation contract (5 minutes)
6. THIS FILE (`_HANDOFF_TO_DEV.md`) — phasing + decisions (you're done)

The reference files (`10_*` through `60_*`) are runtime artifacts the LLM pulls in
on demand — they don't need to be read end-to-end for the wiring decision; skim
section headers.

---

## Open items at handoff

| Item | Owner | Blocker |
|---|---|---|
| Lawcus API auth resolution | Garrison | Sidra reply needed |
| Dashboard `manual_stage_update` engagement-gate bypass | Dev | Architectural call: gate or refactor |
| `clasp` re-auth for Phase 1 push | Garrison | Interactive 2FA |
| Decision on source-of-truth pattern (Q1) | Architect | — |
| Decision on approver UX upgrade (Q2) | Architect | — |
| Decision on telemetry-in-Phase-1 (Q3) | Architect | Trivial — recommend yes |
| Decision on phone infrastructure scope (Q4) | Architect + Garrison | Multiple sub-decisions |
| Decision on SMS_SAFE_MODE clearing gate (Q5) | Garrison | Sign-off criteria needed |

---

## Contact

- Garrison English (founder): garrison@legacyfirstlaw.com
- Codebase: `/Users/garrisonenglish/Legacy First Law/lfl-build/`
- Engine deployment: `AKfycbxlEuQpBIAmTFtoz9WxfIYLAEBrVTQ6MeHJeKWQmpqCUx5rz-kSRxWisODX_0tLRas`
- Project Notion / dashboards: in the LFL Drive
- This document: `lfl-build/01_SYSTEM_PROMPTS/intake_correspondence/_HANDOFF_TO_DEV.md`
