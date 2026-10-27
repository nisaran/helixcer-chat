PRAGMA foreign_keys = ON;

-- Sessions created for the Android app are deliberately distinct from browser
-- cookie sessions.  This prevents a browser cookie from gaining mobile-only
-- privileges merely by being copied into an Authorization header.
ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'browser'
  CHECK(session_type IN ('browser', 'mobile'));
ALTER TABLE sessions ADD COLUMN device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_type_expiry
  ON sessions(session_type, expires_at, revoked_at);

-- A mobile sign-in nonce is issued by this service and can be consumed only
-- once.  Keeping only its SHA-256 hash makes a database read insufficient to
-- replay a Google sign-in response.
CREATE TABLE IF NOT EXISTS mobile_auth_challenges (
  challenge_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_auth_challenges_expiry
  ON mobile_auth_challenges(expires_at, consumed_at);

-- Native Android installations register Firebase Cloud Messaging capability
-- tokens separately from browser Web Push subscriptions. Registration tokens
-- are never returned by workspace list/bootstrap APIs.
CREATE TABLE IF NOT EXISTS mobile_push_devices (
  push_device_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES memberships(membership_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('android')),
  registration_token TEXT NOT NULL UNIQUE,
  last_success_at TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, device_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_workspace
  ON mobile_push_devices(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_membership
  ON mobile_push_devices(membership_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_session
  ON mobile_push_devices(session_id, updated_at DESC);
