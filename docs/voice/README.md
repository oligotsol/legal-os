# Garrison's Voice & Doctrine — Source Material

These files are the ground-truth for **how Garrison wants the AI to talk to clients on
behalf of Legacy First Law.** They were written by Garrison's prior assistant in
2026-05-04/05 for a different codebase (LFL's own Apps Script engine), but the
**doctrine itself is portable** — that's what we apply here in Legal OS.

**Status as of 2026-05-06:** sources captured, not yet applied. See "Apply phase"
below for what's planned.

---

## TL;DR

Garrison wants the AI to:

- Be **intake staff, not the attorney himself.** Sign-off is "— LFL Intake / Legacy
  First Law" (SMS) or a named intake specialist on email (default placeholder
  "Casey at Legacy First Law").
- **Quote immediately** after minimum-viable qualification, flat fee, no hedging.
- **Phone-first** — push to a 5–10 minute call on any sign of hesitation.
- **Drive to close on the same interaction** — engagement letter + payment link.
- **Compliance-locked** — no legal advice, no outcome guarantees, no
  attorney-client implication pre-signing.

---

## File map

| File | Type | Use |
|---|---|---|
| [`00_ROLE_LOCK_INTAKE_CLOSER.md`](./00_ROLE_LOCK_INTAKE_CLOSER.md) | Doctrine (locked) | Garrison's absolute operating rules. **Includes 5 unresolved conflicts that need confirmation before wiring.** |
| [`00_orientation.md`](./00_orientation.md) | Orientation | High-level explanation of the prompt system + how a single conversation runs. Originally `00_README.md` in source. |
| [`01_master_system_prompt.md`](./01_master_system_prompt.md) | **Executable** | The pasteable LLM system prompt. This is the primary artifact — it becomes the new system-prompt builder in `src/lib/ai/prompts/converse.ts`. |
| [`20_qualification.md`](./20_qualification.md) | Reference + decision-tree data | MVQ questions + package decision tree (marital + real estate + kids → package + $). |
| [`30_pricing.md`](./30_pricing.md) | Reference + DB seed source | Full flat-fee schedule, bundles, modifiers, escalation rules, state filing fees. |
| [`99_output_format.md`](./99_output_format.md) | Validation | Output format hard rules + huge banned-phrases list. |
| [`_HANDOFF_TO_DEV_reference_only.md`](./_HANDOFF_TO_DEV_reference_only.md) | **Reference only — not for Legal OS** | Phased rollout plan written for LFL's prior Apps Script engine. The architectural principles transfer; the wiring instructions don't. |
| [`_archived_async_only_pre_2026-05-04.zip`](./_archived_async_only_pre_2026-05-04.zip) | Archive | Prior async-only doctrine, superseded by the phone-first doctrine. Don't use. |

### Files referenced by `01_master_system_prompt.md` but NOT supplied

The master prompt expects six runtime "reference" files that the engine appends to
the user message on demand. We don't have them yet. The master prompt is
self-sufficient without them, but we can't run the full reference layer until
they arrive:

| File | What it should contain |
|---|---|
| `02_execution_template.md` | Input/output contract |
| `10_state_playbooks.md` | S1–S6 detailed actions per state |
| `40_state_notes.md` | TX/IA/ND/PA/NJ specifics, IOLTA, recording |
| `50_objections.md` | 8-category objection playbook |
| `60_micro_scripts.md` | Reference scripts (post-quote, hesitation, ready, call offer, start-now) |

---

## The 5 unresolved doctrine conflicts (READ BEFORE APPLYING)

These are pulled directly from `00_ROLE_LOCK_INTAKE_CLOSER.md`. They reverse current
LFL/Legal OS behavior. **Garrison must explicitly sign off on each before this
doctrine is wired in** — otherwise applying it is a regression for his current
demo experience.

| # | New doctrine | Current behavior | Decision needed |
|---|---|---|---|
| 1 | SMS is an active channel for the closer | Already active in Legal OS (no conflict for us) | None for Legal OS |
| 2 | Phone-first; calls close. Push to call on any hesitation | Async-only. No call infrastructure (no scheduling, no click-to-call). | Phone-first / phone-when-hesitating / no change. **Phone-first is multi-week new infra.** |
| 3 | Quote IMMEDIATELY after MVQ in first touch | Today the AI doesn't quote in first messages | Quote-first or qualify-then-quote |
| 4 | Use "we" (closer is intake staff) | Today AI uses "I" and signs as Garrison | "we" vs "I" — branding choice |
| 5 | Sign-off: "— LFL Intake / Legacy First Law" (SMS), "— Casey at Legacy First Law" (email) | Today: "— Garrison" (SMS), "— Garrison English / Legacy First Law PLLC" (email) | Intake-staff persona OR Garrison-personally |

The single biggest decision is **#4 + #5 together: is the AI Garrison personally, or
is the AI an intake staffer talking *about* Garrison's firm?** That choice ripples
through ~60% of what gets refactored.

---

## Where each piece lands in Legal OS (apply phase plan)

When we apply this (separate session, not yet started), here's the rough mapping:

| Source piece | Destination in Legal OS |
|---|---|
| Master system prompt (file 01) | Rewrite of `src/lib/ai/prompts/converse.ts` system prompt builder. New required `firm_config` keys. Big change — own session. |
| Sign-off rules (00 + 01) | `firm_config.conversation_config.per_jurisdiction_sign_offs` rewritten. New `firm_config.conversation_config.intake_specialist_name` field (defaults to "the LFL Intake Team" if unset). |
| Banned phrases (99) | `firm_config.conversation_config.banned_phrases` — large extension (filler, urgency, AC-pre-signing, sender impersonation). |
| Allowed phrases / language control (00 + 01) | New `firm_config.conversation_config.preferred_phrases` field. |
| MVQ + decision tree (20) | First as a prompt reference block. Eventually a deterministic `pickPackage()` function in `src/lib/ai/qualification.ts`. |
| Pricing schedule (30) | Populate `fee_schedules` and `service_offerings` rows. **Add `floor` column to `fee_schedules`** (schema change). |
| Output format rules (99) | System prompt format section + extended validator in `src/lib/ai/converse.ts`. |
| State playbooks / state notes / objections / micro-scripts | Stored as `firm_config.<key>` rows OR as Markdown blobs in a `firm_documents` table the prompt builder fetches at runtime. (Decide based on edit frequency.) |
| 5-conflict resolutions | One config commit + an entry in `docs/voice/decisions.md` (to be created when Garrison resolves them). |

---

## How to use these files in a future session

1. Open this README.
2. Read the 5-conflict table above — confirm with the user / Garrison which way each
   resolves.
3. Open `01_master_system_prompt.md` — that's the source of truth for the prompt
   structure.
4. Cross-reference with `20_qualification.md`, `30_pricing.md`, `99_output_format.md`
   for the rules that fold into the prompt or DB.
5. Use `_HANDOFF_TO_DEV_reference_only.md` for *thinking* about phasing
   (Phase 1 / 2 / 3 of prompt-system maturity), not for literal wiring.

---

## Sourced from

Originals delivered by user (Oli) on 2026-05-06, sourced from Garrison's prior
assistant's output dated 2026-05-04/05. Originals were in `~/Downloads/`; copies
preserved here for repo-internal versioning.

Don't edit these files in place — they're the immutable record of what Garrison
provided. Any later refinements live in:
- `firm_config` rows (DB) — the runtime configuration the AI actually reads
- `src/lib/ai/prompts/converse.ts` — the executable prompt builder
- `docs/voice/decisions.md` (TBD) — Garrison's resolutions to the 5 conflicts and
  any subsequent doctrine changes
