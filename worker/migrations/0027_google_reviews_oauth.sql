PRAGMA foreign_keys = ON;

-- Google Business / Reviews locations may be reused across workspaces, but never
-- by two connections in the same workspace. Rows are stored as generic_http in
-- connector_type for the legacy CHECK constraint; runtime routing uses
-- provider_type='google_reviews'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_workspace_google_reviews_location
  ON channels(workspace_id, json_extract(config_json, '$.locationId'))
  WHERE provider_type='google_reviews'
    AND json_valid(config_json)
    AND COALESCE(json_extract(config_json, '$.locationId'), '')<>'';

-- Short-lived OAuth state for "Connect with Google" channel linking.
CREATE TABLE IF NOT EXISTS google_business_oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  channel_name TEXT NOT NULL DEFAULT '',
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_oauth_states_expiry
  ON google_business_oauth_states(expires_at);

-- After Google consent, tokens wait here until the user picks a Business location.
CREATE TABLE IF NOT EXISTS google_business_pending (
  pending_id TEXT PRIMARY KEY,
  pending_token_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  channel_name TEXT NOT NULL DEFAULT '',
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  google_email TEXT NOT NULL DEFAULT '',
  locations_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_pending_expiry
  ON google_business_pending(expires_at);
CREATE INDEX IF NOT EXISTS idx_google_business_pending_workspace
  ON google_business_pending(workspace_id, user_id);
