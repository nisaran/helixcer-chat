-- Configurable workspace roles and permission matrices. System roles (owner, admin,
-- agent) are seeded per workspace on first use. Custom roles may be added later.
-- Membership and invitation role CHECKs are relaxed so custom role keys can be stored.
-- Foreign keys are disabled while rebuilding memberships/invitations so dependent
-- rows (push subscriptions, mobile devices) are not cascade-deleted.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS workspace_roles (
  role_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  permissions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_roles_workspace
  ON workspace_roles(workspace_id, sort_order, name);

CREATE TABLE IF NOT EXISTS memberships_new (
  membership_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  allowed_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(workspace_id, user_id)
);

INSERT INTO memberships_new
  (membership_id, workspace_id, user_id, role, status, invited_by_user_id, created_at, updated_at, allowed_channel_ids_json)
SELECT membership_id, workspace_id, user_id, role, status, invited_by_user_id, created_at, updated_at,
  COALESCE(allowed_channel_ids_json, '[]')
FROM memberships;

DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;

CREATE INDEX IF NOT EXISTS idx_memberships_user_status ON memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_workspace_role ON memberships(workspace_id, role, status);

CREATE TABLE IF NOT EXISTS invitations_new (
  invitation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  allowed_channel_ids_json TEXT NOT NULL DEFAULT '[]'
);

INSERT INTO invitations_new
  (invitation_id, workspace_id, email, role, token_hash, status, invited_by_user_id, expires_at, accepted_at, created_at, updated_at, allowed_channel_ids_json)
SELECT invitation_id, workspace_id, email, role, token_hash, status, invited_by_user_id, expires_at, accepted_at, created_at, updated_at,
  COALESCE(allowed_channel_ids_json, '[]')
FROM invitations;

DROP TABLE invitations;
ALTER TABLE invitations_new RENAME TO invitations;

CREATE INDEX IF NOT EXISTS idx_invitations_workspace_status ON invitations(workspace_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_email_ci ON invitations(workspace_id, lower(email), status);

PRAGMA foreign_keys = ON;
