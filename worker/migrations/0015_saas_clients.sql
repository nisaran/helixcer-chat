PRAGMA foreign_keys = ON;

-- The original workspace becomes the operator's internal workspace. Client
-- companies created from the platform admin panel are separate workspaces that
-- can be suspended or permanently deleted without touching internal data.
ALTER TABLE workspaces ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE workspaces ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS platform_admins (
  admin_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_admins_email_ci
  ON platform_admins(lower(email));

CREATE INDEX IF NOT EXISTS idx_workspaces_kind_status
  ON workspaces(kind, status, created_at DESC);

-- Platform administrators may invite a client owner. The original invitation
-- table only allowed admin and agent roles, so rebuild it with owner included.
CREATE TABLE invitations_0015 (
  invitation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO invitations_0015
  (invitation_id, workspace_id, email, role, token_hash, status, invited_by_user_id,
   expires_at, accepted_at, created_at, updated_at)
SELECT invitation_id, workspace_id, email, role, token_hash, status, invited_by_user_id,
  expires_at, accepted_at, created_at, updated_at
FROM invitations;

DROP TABLE invitations;

ALTER TABLE invitations_0015 RENAME TO invitations;

CREATE INDEX IF NOT EXISTS idx_invitations_workspace_status
  ON invitations(workspace_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_email_ci
  ON invitations(workspace_id, lower(email), status);
