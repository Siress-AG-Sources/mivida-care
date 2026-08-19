-- Call log, patient archiving, and 90-day visibility

-- Call log table: tracks every patient contact
CREATE TABLE IF NOT EXISTS call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  called_at TEXT NOT NULL DEFAULT (datetime('now')),
  direction TEXT NOT NULL DEFAULT 'outbound', -- inbound | outbound
  notes TEXT,
  duration_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_call_log_patient ON call_log(patient_id);
CREATE INDEX idx_call_log_date ON call_log(called_at DESC);

-- Add archived status to patients
ALTER TABLE patients ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;