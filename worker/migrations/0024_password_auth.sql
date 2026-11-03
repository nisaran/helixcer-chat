PRAGMA foreign_keys = ON;

-- Password login for invited workspace members. google_sub stays required and unique;
-- password-only accounts use a stable placeholder "password:<user_id>" until Google is linked.
ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  invitation_id TEXT REFERENCES invitations(invitation_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR invitation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_email_ci ON password_reset_tokens(lower(email), expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at);
