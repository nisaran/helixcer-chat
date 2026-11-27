PRAGMA foreign_keys = ON;

-- Short-lived OAuth state for "Login with Instagram" channel linking.
CREATE TABLE IF NOT EXISTS instagram_login_oauth_states (
  state_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  channel_name TEXT NOT NULL DEFAULT '',
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instagram_login_oauth_states_expiry
  ON instagram_login_oauth_states(expires_at);
