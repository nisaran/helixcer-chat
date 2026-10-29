PRAGMA foreign_keys = ON;

-- Existing Helixcer data stays an internal workspace. Client companies created
-- from the platform admin panel are separate workspaces with their own owners.
ALTER TABLE workspaces ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'internal';

CREATE TABLE IF NOT EXISTS user_passwords (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_admins (
  admin_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_admins_email_ci ON platform_admins(lower(email));
