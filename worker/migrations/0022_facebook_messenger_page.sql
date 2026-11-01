PRAGMA foreign_keys = ON;

-- Facebook Messenger Pages may be reused across workspaces, but never by two
-- connections in the same workspace. Rows are stored as generic_http in
-- connector_type for the legacy CHECK constraint; runtime routing uses
-- provider_type='facebook_messenger'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_workspace_facebook_messenger_page
  ON channels(workspace_id, json_extract(config_json, '$.pageId'))
  WHERE provider_type='facebook_messenger'
    AND json_valid(config_json)
    AND COALESCE(json_extract(config_json, '$.pageId'), '')<>'';
