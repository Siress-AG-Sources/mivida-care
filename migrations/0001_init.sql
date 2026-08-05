-- MiVida v0.1 schema (Cloudflare D1, SQLite-compatible)
-- Mirrors DESIGN.md section 3 (Core objects).

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date_of_birth TEXT,
  phone TEXT,
  address TEXT,
  email TEXT,
  membership_level TEXT,
  goals TEXT,
  treatment_phase TEXT,
  expected_contact_interval_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  quantity INTEGER,
  refill_quantity INTEGER,
  start_date TEXT,
  estimated_exhaustion_date TEXT,
  order_by_date TEXT,
  in_transit INTEGER NOT NULL DEFAULT 0,
  delivery_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  cycle_type TEXT,
  start_date TEXT,
  end_date TEXT,
  what_comes_next TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  -- The four questions
  q1_who TEXT,          -- identity/contact/membership/goals/phase
  q2_what_happened TEXT, -- clinical summary, decisions, med changes, symptoms, comms
  q3_workflow TEXT,      -- next steps, owners, due dates, follow-up/lab/refill dates
  q4_question TEXT,      -- question to answer before next visit
  source TEXT NOT NULL DEFAULT 'manual', -- manual | dictation | agent
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id INTEGER REFERENCES encounters(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | overdue | done
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refill_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medication_id INTEGER REFERENCES medications(id) ON DELETE SET NULL,
  -- The 10 fields from the note
  patient_name TEXT,
  dob TEXT,
  phone TEXT,
  address TEXT,
  email TEXT,
  med_name TEXT,
  current_dose TEXT,
  quantity_needed INTEGER,
  estimated_exhaustion_date TEXT,
  order_by_date TEXT,
  delivery_notes TEXT,
  status TEXT NOT NULL DEFAULT 'generated', -- generated | completed | expired
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
  details TEXT,
  generated_date TEXT NOT NULL,
  resolved_date TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
