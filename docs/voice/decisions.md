# Voice Doctrine — Resolutions & Decisions Log

This file records what was actually applied vs. deferred when wiring Garrison's
intake-closer doctrine into Legal OS. The source documents in this folder are
immutable; this file is the running record of how we adapted them.

---

## 2026-05-06 — Initial doctrine application

### Resolved (the 5 conflicts in `00_ROLE_LOCK_INTAKE_CLOSER.md`)

| # | Conflict | Resolution |
|---|---|---|
| 1 | SMS active vs. SMS hard-blocked | **No conflict for Legal OS** — our SMS path was already active. |
| 2 | Phone-first vs. async-only | **Deferred.** Call infrastructure (scheduling, click-to-call routing, calendar integration) does not exist in Legal OS. The doctrine's "5–10 minutes now or later today" promise can't be fulfilled. The closer drives to engagement letter + payment as the close path until phone-first lands as a future milestone. |
| 3 | Quote-immediately vs. qualify-then-quote-later | **Applied.** AI quotes immediately after Minimum Viable Qualification per the doctrine. |
| 4 | "We" vs. "I" | **Applied — "we"** (intake staff persona). |
| 5 | Sign-off — Garrison personally vs. intake staff | **Applied — intake staff.** SMS: `LFL Intake / Legacy First Law`. Email: `the LFL Intake Team / Legacy First Law / LegacyFirstLaw.com`. Em-dash separator from the source docs replaced with newline-only per Garrison's earlier "no em dashes" rule. |

### Applied to Legal OS

**Database (`firm_config` rows for LFL):**

- `negotiation_config.tone` — replaced with the doctrine's tone (`Warm, direct, fast, certain. Speed + clarity + control. No filler.`).
- `negotiation_config.persona` — new key, value `"intake_staff"`.
- `negotiation_config.use_we_pronoun` — new key, `true`.
- `conversation_config.closer_doctrine_enabled` — new key, `true`. **Toggle to disable the doctrine without code changes.**
- `conversation_config.intake_specialist_name` — new key, default `"the LFL Intake Team"`.
- `conversation_config.quote_immediately` — new key, `true`.
- `conversation_config.banned_phrases` — extended from 18 → 55 entries (legal-advice patterns, AC-pre-signing, filler, urgency, sender-impersonation, sync-but-wrong like "schedule a consultation").
- `conversation_config.preferred_phrases` — new key. The doctrine's "Use" list, em-dash sanitized.
- `conversation_config.per_jurisdiction_sign_offs` — rewritten to intake-staff form, no leading separator (AI is instructed to place on its own line).
- `sms_config.sign_off` and `email_config.sign_off` — same.
- `firm_scope` — new top-level firm_config key. Lists active practice areas (`estate_planning`, `business_transactional`), active states (`TX, IA, ND, PA, NJ`), and out-of-scope redirects (Amicus Lex for litigation, Thaler IP for trademark).

**Code:**

- `src/lib/ai/prompts/converse.ts` — added `buildIntakeCloserDoctrine()`. When `closerDoctrineEnabled` is true, the system prompt is built from the doctrine sections (ROLE LOCK, FIRM SCOPE, MISSION, OPERATING DOCTRINE, S1–S6 CLIENT STATE AUTO-DETECTION, MVQ, PRICING DELIVERY, CLOSING SEQUENCE, OBJECTION HANDLING, CHANNEL EXECUTION, LANGUAGE CONTROL, ETHICS FILTER) instead of the legacy section-based prompt. Phone-first sections from the source doctrine are deliberately omitted; the closing sequence pushes engagement letter + payment.
- `src/lib/ai/conversation/generate-draft-reply.ts` — reads the new `firm_config` keys + `firm_scope` row and threads them through to the prompt builder.
- Legacy prompt path still exists for any firm without `closer_doctrine_enabled`.

### Verified live

Fresh simulated email inbound on 2026-05-06 produced this AI draft (compare with previous "Hi, I'm Garrison with Legacy First Law" voice):

> Sorry for your loss. We can help with Texas estate matters.
>
> To give you an accurate flat fee, two quick questions: (1) Did your mother own real estate in Texas? (2) Did she have a will or trust in place?
>
> LFL Intake / Legacy First Law

AI's internal reasoning shows S1–S6 state classification, scope check (probate vs. estate planning), banned-phrase check, AC-implication check.

### Deferred (still on the roadmap)

| Item | Why deferred | Rough effort when picked up |
|---|---|---|
| Phone-first call ask + scheduling primitive | No call infrastructure built (Cal.com / Google Calendar integration, click-to-call, intake-staff Dialpad lines) | ~1–2 weeks |
| Pricing schedule into `fee_schedules` table | Today the AI memorizes pricing in the prompt. Better path: structured rows + lookup. Requires `floor` column, schema migration, seed | ~half day |
| MVQ as deterministic `pickPackage()` function | Today MVQ is a prompt rule. Better: deterministic logic that picks the right package given marital + real estate + kids + special factors. Removes LLM judgment from quoting | ~1 day |
| Validator: post-AI banned-phrase regex check | Currently the AI is instructed to avoid banned phrases. Stronger: scan the output and reject/rewrite on match | ~2 hours |
| Reference layer (`02_execution_template`, `10_state_playbooks`, `40_state_notes`, `50_objections`, `60_micro_scripts`) | Source files not provided. Not blocking — master prompt is self-sufficient. Pull in when files arrive | varies |
| `intake_specialist_name` per actual person on the day | Today defaults to "the LFL Intake Team". A future tenant config could let Garrison set a real first name (e.g. "Casey") that signs every draft on a given day | ~1 hour |

---

## How to disable the doctrine

If a draft regresses badly or Garrison wants to revert to the prior "Hi, I'm Garrison" voice:

```sql
UPDATE firm_config
   SET value = jsonb_set(value, '{closer_doctrine_enabled}', 'false'::jsonb)
 WHERE firm_id = '00000000-0000-0000-0000-000000000001'
   AND key = 'conversation_config';
```

The legacy prompt builder takes over within seconds. No code change.

---

## Adding a new firm with the doctrine

1. Insert into `firms` (vertical=`legal`, sub_vertical=their practice area).
2. Seed `firm_config`:
   - `conversation_config` with `closer_doctrine_enabled: true`, `intake_specialist_name`, sign-offs, banned/preferred phrases.
   - `negotiation_config` with `persona: "intake_staff"`, tone, attorney name.
   - `firm_scope` with active practice areas + states + redirects for out-of-scope.
3. Seed `integration_accounts` (Dialpad, Gmail, etc.) with their credentials.
4. No code changes.
