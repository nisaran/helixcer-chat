PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The workspace exists before any person signs in. No administrator is seeded here.
INSERT OR IGNORE INTO workspaces (workspace_id, slug, name, created_at, updated_at)
VALUES ('ws_default', 'default', 'Helixcer Chat', datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  last_login_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci ON users(lower(email));

CREATE TABLE IF NOT EXISTS memberships (
  membership_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_status ON memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_workspace_role ON memberships(workspace_id, role, status);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(token_hash, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, workspace_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  invitation_token_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS invitations (
  invitation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_workspace_status ON invitations(workspace_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_email_ci ON invitations(workspace_id, lower(email), status);

-- Existing business data is assigned to the single current workspace. IDs remain globally unique,
-- while every query can now be workspace-scoped before additional tenants are introduced.
ALTER TABLE channels ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE contacts ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE channel_identities ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE conversations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE messages ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE webhook_events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE outbox ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE agents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE audit_log ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE audit_log ADD COLUMN actor_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN actor_email TEXT NOT NULL DEFAULT '';

UPDATE channels SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE contacts SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE channel_identities SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE conversations SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE messages SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE webhook_events SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE outbox SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE agents SET workspace_id='ws_default' WHERE workspace_id IS NULL OR workspace_id='';
UPDATE audit_log SET workspace_id='ws_default', actor_email=actor WHERE workspace_id IS NULL OR workspace_id='' OR actor_email='';

CREATE INDEX IF NOT EXISTS idx_channels_workspace ON channels(workspace_id, enabled, name);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id, display_name);
CREATE INDEX IF NOT EXISTS idx_identities_workspace_profile ON channel_identities(workspace_id, channel_id, channel_profile_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_activity ON conversations(workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_status ON conversations(workspace_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_workspace_conversation ON messages(workspace_id, conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_workspace_provider ON messages(workspace_id, channel_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhook_events(workspace_id, channel_id, received_at);
CREATE INDEX IF NOT EXISTS idx_outbox_workspace_due ON outbox(workspace_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_time ON audit_log(workspace_id, timestamp DESC);
