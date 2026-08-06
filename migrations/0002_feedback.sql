-- Add feedback table for Mi Vida team input/feature requests

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitted_by TEXT,
  category TEXT,           -- feature_request | bug | workflow_question | idea | other
  body TEXT NOT NULL,      -- the plain-sentence input
  context TEXT,            -- optional: what page/patient/view they were on
  status TEXT NOT NULL DEFAULT 'new',  -- new | reviewed | planned | done | declined
  notes TEXT,              -- response or resolution notes
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_created ON feedback(created_at);