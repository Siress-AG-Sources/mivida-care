-- Who looked at which patient record, and when.
--
-- Writes were already audited; reads were not, so "who accessed this patient's
-- record" was unanswerable for every record in the system.
--
-- Reads are far higher volume than writes — the status board alone issues one
-- request per patient on every load — so accesses are coalesced into 15-minute
-- buckets. window_key carries the bucket and is UNIQUE, which makes the
-- coalescing an INSERT .. ON CONFLICT rather than a read-modify-write: fifty
-- concurrent requests from one board load collapse to one row per patient
-- instead of racing each other into fifty duplicates.
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,              -- "name@example.com (#3)" or "legacy-token"
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  patient_id INTEGER,               -- null for list views that span patients
  scope TEXT NOT NULL,              -- patient_record | patient_list | prescribing_list | ...
  route TEXT NOT NULL,
  window_key TEXT NOT NULL,         -- actor|patient|scope|YYYY-MM-DDTHH:MM (15-min bucket)
  hits INTEGER NOT NULL DEFAULT 1,
  first_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_window ON access_log(window_key);
CREATE INDEX IF NOT EXISTS idx_access_patient ON access_log(patient_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_actor ON access_log(actor, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_time ON access_log(last_at DESC);
