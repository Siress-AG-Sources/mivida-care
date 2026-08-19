-- Link call records to the prescriptions discussed on the call.
-- Many-to-many: one call can cover several prescriptions, or none at all.

CREATE TABLE IF NOT EXISTS call_medications (
  call_id INTEGER NOT NULL REFERENCES call_log(id) ON DELETE CASCADE,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  PRIMARY KEY (call_id, medication_id)
);

CREATE INDEX IF NOT EXISTS idx_call_meds_med ON call_medications(medication_id);
