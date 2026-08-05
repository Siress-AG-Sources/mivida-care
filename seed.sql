-- MiVida v0.1 seed data
-- Prototype: Tony's case as the first practical example (per the workflow note)

-- Patient profile (placeholder — replace with real details)
INSERT INTO patients
  (name, date_of_birth, phone, address, email, membership_level, goals,
   treatment_phase, expected_contact_interval_days)
VALUES
  ('Tony S.', '1970-01-01', '555-0100', 'Ajijic, MX', 'tony@example.com',
   'intensive', 'Recovery and mobility after multiple surgeries; track outcomes',
   'recovery', 14);

-- Medication/treatment tracking
INSERT INTO medications
  (patient_id, name, dose, quantity, refill_quantity, start_date,
   estimated_exhaustion_date, order_by_date, in_transit, delivery_notes)
VALUES
  (1, 'Gabapentin', '300mg 3x daily', 90, 90, '2026-07-01',
   '2026-08-30', '2026-08-15', 0, 'Local pharmacy pickup'),
  (1, 'Lisinopril', '10mg 1x daily', 30, 30, '2026-07-15',
   '2026-08-14', '2026-08-01', 1, 'Ship to home');

-- Current treatment cycle
INSERT INTO cycles
  (patient_id, cycle_type, start_date, end_date, what_comes_next)
VALUES
  (1, 'post-surgical recovery', '2026-07-01', '2026-09-30', 'Reassessment and mobility goals review');

-- First encounter — demonstrates the four questions
INSERT INTO encounters
  (patient_id, occurred_at, q1_who, q2_what_happened, q3_workflow, q4_question, source)
VALUES
  (1, '2026-07-22 10:00:00',
   'Tony S., intensive member, recovery phase. Goals: mobility, pain reduction.',
   'Initial post-surgical assessment. Pain reported as 4/10, improving. Started gabapentin; lisinopril for BP. No adverse reactions.',
   'Follow-up in 2 weeks. Lab panel ordered for 2026-08-05. Refill planning: gabapentin order by 2026-08-15, lisinopril by 2026-08-01.',
   'Is pain decreasing with the current gabapentin dose?',
   'manual');

-- Open task
INSERT INTO tasks
  (patient_id, encounter_id, description, owner, due_date, status)
VALUES
  (1, 1, 'Complete lisinopril refill order in pharmacy platform', 'Provider', '2026-08-01', 'open'),
  (1, 1, 'Review lab results and confirm next cycle', 'Provider', '2026-08-07', 'open');

-- Settings — configurable thresholds from the note
INSERT INTO settings (key, value) VALUES
  ('contact_interval_days', '30'),
  ('exhaustion_lead_days', '14'),
  ('followup_overdue_days', '7'),
  ('task_overdue_days', '3');
