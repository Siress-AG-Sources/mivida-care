-- Prescription lifecycle + what a call decided about each prescription.
--
-- Two different removals are possible and they must not be confused:
--   discontinue = clinical decision, the patient was on it and stopped. Kept.
--   delete      = data-entry error, it was never prescribed. Removed entirely.
-- Only the first is modelled here; deletion is a DELETE on the row.

ALTER TABLE medications ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- active | discontinued
ALTER TABLE medications ADD COLUMN discontinued_at TEXT;
ALTER TABLE medications ADD COLUMN discontinued_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_medications_status ON medications(patient_id, status);

-- What was decided about this prescription on this call:
-- no_change | refill_needed | dose_changed | discontinued
ALTER TABLE call_medications ADD COLUMN action TEXT NOT NULL DEFAULT 'no_change';
