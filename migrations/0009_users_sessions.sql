-- Named users, so every action in the clinical record is attributable to a
-- person. Until now one shared bearer token served everyone and every audit
-- row recorded actor = "system".

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',        -- super_admin | physician | staff | readonly
  -- Effective capabilities, stored explicitly rather than derived from the role
  -- at request time: a super-admin can see and edit exactly what each person
  -- has, and "why could she do that?" is answerable from the row itself.
  capabilities TEXT NOT NULL DEFAULT '[]',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 150000,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',     -- active | archived
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,                  -- SHA-256 of the bearer token; the token itself is never stored
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
