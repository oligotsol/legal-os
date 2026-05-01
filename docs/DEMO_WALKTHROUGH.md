# Demo Walkthrough — Legal OS v1

Run `npm run dev` then open http://localhost:3000

---

## Flow: Lead → Matter → Fee Quote → Engagement Letter

### Step 1: Log In
- URL: http://localhost:3000
- Use your Supabase auth credentials (the LFL owner account)

---

### Step 2: Dashboard
- URL: http://localhost:3000/dashboard
- Shows: Active matters, AI spend, approval summary, SLA queue, pipeline funnel
- **Talk track:** "This is the command center. Everything the attorney needs at a glance."

---

### Step 3: Create a Lead
- Navigate: **Leads** in sidebar → **+ New Lead** button (top right)
- Fill in:
  - Name: "John Smith"
  - Email: john@example.com
  - Phone: (555) 123-4567
  - Source: Manual
  - Channel: Phone
- Click **Create Lead**
- **Talk track:** "Leads come in from LegalMatch, web forms, Dialpad calls, or manual entry. All land here."

---

### Step 4: Convert Lead to Matter
- From the leads list, click the new lead
- Click **Convert to Matter**
- Fill in:
  - Matter type: estate_planning
  - Jurisdiction: TX
  - Summary: "Simple will + POA"
- Confirm
- **Talk track:** "Once qualified, the lead becomes a matter and enters the pipeline."

---

### Step 5: Pipeline View
- Navigate: **Pipeline** in sidebar
- URL: http://localhost:3000/pipeline
- See the matter card in "New Lead" column
- Click the matter card to open detail sheet
- **Talk track:** "The pipeline shows every matter's stage with SLA colors. Green = on track. Yellow/red = needs attention."

---

### Step 6: Transition Through Stages
- In the matter detail sheet, use **Transition** buttons:
  - New Lead → First Touch
  - First Touch → Awaiting Reply (this triggers drip sequence — Day 2/5/7/10 follow-ups auto-scheduled)
  - Awaiting Reply → In Conversation
  - In Conversation → Fee Quoted
- **Talk track:** "Each transition is logged in the audit trail. Moving to 'Awaiting Reply' auto-schedules AI drip follow-ups."

---

### Step 7: Create Fee Quote
- In the matter detail sheet, click **Create Fee Quote**
- Lands on fee calculator: http://localhost:3000/pipeline/fee-calculator?matter_id=...
- Select services (e.g., Simple Will $1,500 + Power of Attorney $500)
- Toggle bundle pricing if applicable
- Review total at bottom
- Click **Save & Submit for Approval**
- **Talk track:** "Fee quotes are built from the service catalog with bundle discounts. Every quote requires attorney approval before it reaches the client."

---

### Step 8: Approve Fee Quote
- Navigate: **Approvals** in sidebar
- URL: http://localhost:3000/approvals
- See the pending fee quote
- Click to expand — shows line items, discounts, total
- Click **Approve**
- **Talk track:** "Three things always need attorney sign-off: fee quotes, engagement letters, and invoices. No exceptions, no bypass."

---

### Step 9: Generate Engagement Letter
- Navigate back to **Pipeline** → click the matter
- The detail sheet now shows the approved fee quote amount
- Click **Generate Engagement Letter**
- Redirects to engagements page with the draft letter
- Shows template variables: client name, fees, IOLTA rules, jurisdiction-specific terms
- **Talk track:** "The engagement letter auto-populates from the fee quote + Texas jurisdiction rules. IOLTA trust requirements, milestone billing splits — all pulled from config."

---

### Step 10: Conversations (if seeded)
- Navigate: **Conversations** in sidebar
- Shows AI qualification conversations with leads
- Each message shows phase (qualification, follow-up, negotiation)
- **Talk track:** "The AI handles initial qualification conversations. Every outbound message goes through approval before sending."

---

## Key Points for Garrison

1. **Nothing goes to a client without attorney approval** — fee quotes, engagement letters, invoices, AI-generated messages
2. **Full audit trail** — every action is hash-chained and append-only, tamper-evident
3. **AI drip follow-ups** — Day 2/5/7/10 sequence auto-generates when a lead goes to "Awaiting Reply", cancels on inbound reply
4. **Multi-tenant from day one** — when we onboard firm #2, it's config, not code
5. **Jurisdiction-aware** — IOLTA rules, earning methods, consent requirements all driven by state

---

## What's NOT in this demo (v2+)

- Document generation (wills, trusts, POA docs)
- Triple-verify workflow
- Confido payment integration (pending Lawcus API access)
- Auto-delivery of signed docs
- Post-delivery workflows

---

## If something breaks during demo

- Check terminal for errors (they now report to Sentry too)
- Dashboard data requires seed data — run `npx tsx scripts/seed-lfl-demo.ts` if tables are empty
- Pipeline needs stages seeded — run `npx tsx scripts/seed-lfl-pipeline.ts` if no stages show
