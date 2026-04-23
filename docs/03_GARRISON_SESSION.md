# Business Logic Extraction — Session with Garrison

**Format:** One 60-90 minute recorded call. You interview, I transcribe and extract specs.

**Why a call, not a questionnaire:** Garrison knows this stuff instinctively. Talking through it is 5x faster than writing it up, and the back-and-forth surfaces things neither of us thought to ask.

**After the call:** I produce structured specs (fee schedule JSON, pipeline stage definitions, drip template library, system prompt drafts) that become the v1 seed data.

---

## Pre-call prep (send to Garrison 24 hours before)

Ask him to come prepared with:
- His current fee schedule (whatever form it's in — spreadsheet, napkin, in his head).
- Rough pipeline stages he uses day-to-day.
- A few recent lead scenarios he remembers clearly.
- Access/credentials list: LegalMatch, NonStop, Lawcus, Dialpad, Confido, Dropbox Sign.

---

## Session Agenda

### Block 1 — How leads come in (10 min)

1. Every source of leads right now: LegalMatch, NonStop, website, referrals, inbound calls. Which volumes, which quality?
2. What happens the moment a lead arrives? What's the first outbound action, how fast does it need to happen?
3. Which leads does he refuse or refer out immediately? (Amicus Lex referrals — what triggers those?)
4. DNC rules: how does someone land on the DNC list? What are the rules about contacting them again?

### Block 2 — Classification (10 min)

5. When a lead arrives, what does he need to know about them in the first 60 seconds to decide how to respond?
6. Matter types he sees (estate planning, business transactional, what else)? How does he tell them apart from the initial inquiry?
7. What makes a lead "hot" vs. "cold" for him? What signals does he look for?
8. Red flags that should pause AI engagement and route to him immediately (price shopper, prior attorney conflict, difficult personality, out-of-scope matter)?

### Block 3 — The conversation (15 min)

9. Walk through a typical conversation from first-touch to scheduled call. What does the AI say, what does the client say, what's the flow?
10. His voice and tone. Warm? Direct? Formal? Examples of phrases he uses vs. phrases he avoids.
11. How does the AI know when to stop drafting and say "you need to call this person now"? Stage-based, signal-based, or judgment call?
12. Spanish speakers — how does he handle them? AI converses in Spanish, or flags immediately?
13. Spouse handling — couples planning together. One lead, two leads, one matter, two matters?
14. How many messages before the AI should push for a scheduled call? What if the client resists?

### Block 4 — The pipeline (10 min)

15. His actual pipeline stages. He's listed 18 in design docs — which ones are real and useful, which are ceremonial?
16. SLAs per stage: how long should a lead sit in stage X before he wants it flagged?
17. Which transitions are automatic (payment received → next stage) vs. attorney-triggered?
18. What makes a matter "DEAD" vs. "LOST" vs. "DNC" vs. "REFERRED"? Distinctions matter.

### Block 5 — Fees and negotiation (15 min)

19. Current fee schedule: by state, by service. List prices, floor prices. Get him to talk through all of it.
20. Bundled services — does he offer packages (will + POA + healthcare + trust)? Bundle pricing rules?
21. Negotiation rules. Client says "that's too expensive" — what does he do? How low will he go? What triggers "no, I can't go lower"?
22. Deposit rules — does he require a deposit to start, or is it pay-in-full upfront? Payment plans?
23. The 21-competitor playbook — walk through the top 5 competitors by frequency. What do clients say, what's the rebuttal?

### Block 6 — Engagement and payment (10 min)

24. Engagement letter flow: client says yes, what happens? Template per state — is there one master template with state variants, or five separate templates?
25. Variables in the engagement letter: beyond name/fee/date, what else gets filled in?
26. State-specific disclosures required by bar rules (advertising, advance fee, IOLTA). For each state: what language is mandatory?
27. Payment timing: does he invoice immediately on signature, or is there a gap? Can the client pay before signing?
28. IOLTA routing per state: which states require trust deposit, which allow earned-on-receipt for flat fees? (Verify with his malpractice carrier if unsure.)
29. Refund policy: client pays then backs out before work starts — what happens?

### Block 7 — The Command Center UX (10 min)

30. When he's working, what does he need to see at all times? What can be hidden behind a click?
31. During a call with a lead, what does he want on screen: conversation history, script prompts, competitor rebuttals, fee calculator, objection responses?
32. How often does he want the screen to refresh? Real-time, 5 seconds, manual?
33. Mobile usage — does he ever work from phone, or is this desktop-only?

### Block 8 — The approval queue (10 min)

34. Approval mode defaults: all outbound requires approval by default, okay? Any exceptions from day one?
35. When something is in the queue and urgent, how does he want to be notified? Email, SMS, in-app, phone?
36. What's the realistic SLA — how fast does he need to review queued messages? Minutes, hours?
37. What does "edit and approve" look like to him? Quick text edit, full rewrite?
38. Can the AI ever act without approval? Under what conditions would he feel comfortable granting autonomy?

### Block 9 — Compliance (10 min)

39. Malpractice carrier guidance on AI use — any specific requirements or disclosures?
40. Bar disclosure requirements per state for AI use. What does he currently disclose to clients about AI involvement?
41. Retention policy: how long does he keep matter records after closure? Varies by state — which states, what rules?
42. Conflict-of-interest checks — how does he currently run them? Any automated input we should build in?

### Block 10 — Strategy and post-v1 (5 min)

43. Who's the first white-label tenant he's thinking about? (Amicus Lex is the natural candidate.)
44. What differentiates "Legacy First Law" as a brand vs. the platform as a product, if/when he white-labels?
45. What's his gut feel on the 8-week timeline for the v1 scope we defined? Anything he'd add or cut?
46. What does he most want to see working by end of week 3? Week 6? Week 8?

---

## Post-call deliverables (my output, within 48 hours)

From the call recording/transcript, I produce:

1. **Fee schedule spec** — per state, per service, list + floor + bundles, ready to seed `fee_schedules` table.
2. **Pipeline spec** — finalized stages, SLAs, transition rules, ready to seed `pipeline_stages` table.
3. **Drip campaign spec** — template slots for Day 1/3/7/14/21/30, tone guidelines per slot.
4. **System prompt drafts** — per-state AI behavior, ready for first round of testing.
5. **Competitor playbook spec** — top competitors, objections, rebuttals, ready to seed `playbook_entries`.
6. **Jurisdiction rules spec** — state-specific disclosures, IOLTA rules, bar requirements.
7. **Open questions list** — anything we didn't fully nail down, ready for follow-up async.

---

## Notes on running the call

- Record it (with consent). Zoom, Google Meet, whatever works.
- Don't try to get every detail — aim for 80% coverage. Follow-ups are cheap.
- If he starts going deep on document generation or triple-verify, redirect gently: "That's v2, let's stay focused on v1."
- If he's wishy-washy on something, note it and move on. We'll pick sensible defaults and he can refine later.
- End with a clear "next step" — when the next check-in is, what he owes us by when.

---

## If a full call isn't possible

Fallback: send the questions as a structured doc, he answers async over 2-3 days. Slower, less rich, but workable. Not recommended unless a live call genuinely can't happen.
