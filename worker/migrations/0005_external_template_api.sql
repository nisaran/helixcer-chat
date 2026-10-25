PRAGMA foreign_keys = ON;

-- Workspace-scoped server credentials for Helixcer's public API. The full
-- credential is returned once at creation time; only its SHA-256 digest is
-- retained here.
CREATE TABLE IF NOT EXISTS api_keys (
  api_key_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["whatsapp:template:send","messages:read"]',
  allowed_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TEXT,
  last_used_at TEXT,
  created_by_user_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_status
  ON api_keys(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON api_keys(key_prefix);

-- Complete provider-bound template payloads may contain signed media URLs and
-- customer variables. They are encrypted with workspace/message-bound AAD and
-- removed as soon as delivery reaches a terminal submission result.
CREATE TABLE IF NOT EXISTS outbound_payloads (
  message_id TEXT PRIMARY KEY REFERENCES messages(message_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_payloads_workspace
  ON outbound_payloads(workspace_id, created_at);

-- Idempotency records bind a caller-supplied key to one normalized request and
-- one inbox message. The caller's raw key is never retained.
CREATE TABLE IF NOT EXISTS external_api_requests (
  request_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  api_key_id TEXT NOT NULL REFERENCES api_keys(api_key_id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  client_reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(api_key_id, operation, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_external_requests_message
  ON external_api_requests(api_key_id, message_id);
CREATE INDEX IF NOT EXISTS idx_external_requests_expiry
  ON external_api_requests(expires_at);
