PRAGMA foreign_keys = ON;

-- Short-lived OAuth state for "Continue with Facebook" Messenger Page linking.
CREATE TABLE IF NOT EXISTS messenger_login_oauth_states (
  state_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  channel_name TEXT NOT NULL DEFAULT '',
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messenger_login_oauth_states_expiry
  ON messenger_login_oauth_states(expires_at);
