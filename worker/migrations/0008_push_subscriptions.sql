PRAGMA foreign_keys = ON;

-- One browser installation can subscribe to Web Push for one workspace member.
-- Endpoints and encryption keys are browser-issued capability values and are
-- never returned through workspace APIs after they are stored.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES memberships(membership_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  user_agent TEXT NOT NULL DEFAULT '',
  last_success_at TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, membership_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_workspace
  ON push_subscriptions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_membership
  ON push_subscriptions(membership_id, updated_at DESC);
