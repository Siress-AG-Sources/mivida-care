-- Track deploy events to power the "What's New" feed and notifications

CREATE TABLE IF NOT EXISTS deploy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT,                     -- git commit SHA or tag
  summary TEXT NOT NULL,            -- short headline (e.g. "Feedback capture panel + exception dedup")
  details TEXT,                     -- markdown changelog or longer description
  deployed_by TEXT DEFAULT 'ci',    -- who triggered the deploy (ci | tony | assistant)
  live_url TEXT,                    -- link to the live platform
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_deploy_events_created ON deploy_events(created_at DESC);