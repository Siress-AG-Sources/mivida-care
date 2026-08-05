# MiVida Care Workflow System — Design v0.1

Source: "Work Flow Note to Tony Siress.docx" (22 July 2026)
Working directory: ~/Sites/mivida

## 1. Purpose

Turn every verbal clinical decision into a written patient schedule and a dated
workflow immediately after the conversation, then monitor continuity and
surface exceptions so nothing slips.

## 2. Non-negotiable boundaries

- The AI never prescribes, never doses, never submits pharmacy orders. It
  recognizes when a refill/new order is needed and produces a prompt the
  provider executes manually in the pharmacy platform.
- The AI structures what the provider decided. It does not decide.
- Every record traces to a dated source (verbal note, provider edit, system
  check). Audit log.
- Patient data handled per applicable law (US HIPAA / MX LFPDPPP). Local-first
  storage by default; encrypted; access-controlled.

## 3. Core objects (data model)

- Patient: identity/contact, membership level, goals, treatment phase,
  expected contact interval (configurable per patient), outcomes tracked.
- Medication: name, dose, quantity, start date, estimated exhaustion date,
  in-transit status, order-by date, delivery notes.
- Cycle: type, start, end date, what comes next.
- Encounter: date, provider, the four-question answers, decisions, medication
  changes, symptoms/outcomes reported, communications.
- Task: description, owner, due date, status (open/overdue/done).
- RefillPrompt: generated from Patient + Medication; the 10 fields from the
  note; status (generated / completed / expired).
- Exception: type, patient, severity, generated date, resolved date.
- AuditEvent: timestamp, actor, action, before/after.

## 4. The four questions (every encounter)

1. Who is this? — identity/contact, membership level, current goals, treatment
   phase.
2. What happened today? — clinical summary, decisions, medication changes,
   treatments continued/stopped, symptoms or outcomes, important
   communications.
3. What is the workflow? — next steps, task owner, due dates, follow-up date,
   laboratory date, refill planning date, estimated medication exhaustion
   date, receipt confirmation, overdue/incomplete items.
4. What question are we trying to answer before the next visit? — e.g. sleep
   improving? recovery better? pain decreasing? tolerating treatment?
   measurable benefit? continue / change / stop?

## 5. Refill / order prompt generator

Trigger: medication exhausts within threshold, or order-by date passes, or a
new order is decided at an encounter.

Output prompt (exactly the fields the note lists):
- Patient name
- Date of birth
- Telephone number
- Address
- Email
- Medication or treatment requiring refill
- Current dose
- Quantity needed
- Estimated date supply runs out
- Date by which the order must be placed
- Delivery / transportation considerations

The provider completes the order manually in the pharmacy platform; the system
tracks prompt status and confirms receipt.

## 6. Exception monitor (configurable thresholds)

Default rules from the note:
- No patient contact for 30 days (interval configurable per patient)
- Patient overdue for follow-up
- Medication likely to run out within two weeks
- Prescription prompt generated but not completed
- Labs overdue
- Treatment cycle ending without a reassessment scheduled
- Patient has not confirmed receipt of medication
- Assigned team task remains incomplete

Daily run; output = attention list grouped by severity.

## 7. Status board — always able to tell us

Per patient, live view answering: what they take now, current cycle, when the
cycle ends, what comes next, medication on hand, what is in transit, when to
place the next order, last meaningful contact, outcomes tracked, decision
expected at next review.

## 8. Recommended architecture (v0.1)

- Local-first: SQLite + Python (FastAPI) web app on the practice machine;
  browser UI. Same pattern as the collab viewers Tony already runs.
- Encounter capture v0.1: paste/type the note into the four-question form.
- Daily exception monitor: scheduled task (cron / launchd).
- Backup: encrypted snapshot to cloud or Time Machine.
- v0.2: voice transcription (Whisper) for dictation; agent-assisted drafting
  of encounter summaries; multi-provider roles and team tasks; optional cloud
  deployment with BAA / LFPDPPP compliance.

## 9. Roadmap

- v0.1 MVP: patient registry + encounter capture (four-question form) + refill
  prompt generator + exception monitor + status board. Seeded with Tony's case
  as the prototype.
- v0.2: voice capture, agent drafting, team/roles, cloud option.
- v0.3: integrations (pharmacy platform, labs, calendar) as they become
  concrete.

## 10. Open questions

- Where does the practice operate (privacy law, pharmacy platform)?
- Team size and roles: who logs encounters, who completes orders?
- How will notes enter: paste, voice, both?
- Volume: how many active patients?
- Existing EHR to coexist with or import from?

## 11. Decisions made so far

- Local-first by default.
- AI administrative only — never prescriber.
- Tony's case seeds the prototype.
